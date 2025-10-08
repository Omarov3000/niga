import { expect, it, describe, vi } from 'vitest'
import { o } from '../schema/builder'
import { ulid } from 'ulidx'
import type { DbMutationBatch } from './types'
import { AlwaysOnlineDetector, ControllableOnlineDetector } from './test-online-detector'
import { _makeClientDb, _makeHttpRemoteDb, _makeRemoteDb, UnstableNetworkFetch } from './test-helpers'
import { RemoteDbClient } from './remote-db'
import { createFetchWrapper } from './fetch-wrapper'
import type { DerivationContext } from '../schema/types'
import { sql } from '../utils/sql'

it('syncs data from remote on initialization', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
    email: o.text(),
  })

  const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })
  await serverDb.users.insertMany([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
  ])

  const { db } = await _makeClientDb({ users }, remoteDb, { skipPull: false, debugName: 'client1' })

  const result = await db.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
  ])
})

it('handles empty remote database', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
  })

  const { remoteDb } = await _makeRemoteDb({ users })
  const { db } = await _makeClientDb({ users }, remoteDb, { skipPull: false, debugName: 'client1' })

  const result = await db.users.select().execute()

  expect(result).toHaveLength(0)
})

it('syncs multiple tables', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
  })

  const posts = o.table('posts', {
    id: o.id(),
    title: o.text(),
    authorId: o.idFk(),
  })

  const userId1 = ulid()
  const userId2 = ulid()
  const postId1 = ulid()
  const postId2 = ulid()

  const { db: serverDb, remoteDb } = await _makeRemoteDb({ users, posts })

  await serverDb.users.insertMany([
    { id: userId1, name: 'Alice' },
    { id: userId2, name: 'Bob' }
  ])
  await serverDb.posts.insertMany([
    { id: postId1, title: 'First Post', authorId: userId1 },
    { id: postId2, title: 'Second Post', authorId: userId2 }
  ])

  const { db } = await _makeClientDb({ users, posts }, remoteDb, { skipPull: false, debugName: 'client1' })

  const userResult = await db.users.select().execute()
  const postResult = await db.posts.select().execute()

  expect(userResult).toHaveLength(2)
  expect(postResult).toMatchObject([
    { title: 'First Post', authorId: userId1 },
    { title: 'Second Post', authorId: userId2 }
  ])
})

it('resumes pull from last synced offset', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
  })

  // Create remote DB with 5 users
  const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })

  await serverDb.users.insertMany([
    { id: ulid(), name: 'User 1' },
    { id: ulid(), name: 'User 2' },
    { id: ulid(), name: 'User 3' },
    { id: ulid(), name: 'User 4' },
    { id: ulid(), name: 'User 5' }
  ])

  // First sync - create a fresh db and pull all data
  const { db: db1, driver: driver1 } = await _makeClientDb({ users }, remoteDb, { skipPull: false, debugName: 'client1' })

  // Verify first sync got all 5 users
  const result1 = await db1.users.select().execute()
  expect(result1).toHaveLength(5)

  // Verify pull was marked as complete
  const progress = await driver1.run({
    query: 'SELECT state FROM _sync_pull_progress WHERE table_name = ?',
    params: ['users'],
  })
  expect(progress[0].state).toBe('all')

  // Create new synced db instance - should skip pull since it's already complete
  const db2 = await o.syncedDb({
    schema: { users },
    driver: driver1,
    remoteDb,
    onlineDetector: new AlwaysOnlineDetector(),
    debugName: 'client1-reopen',
  })

  // Verify data is still there (pull was skipped)
  const result2 = await db2.users.select().execute()
  expect(result2).toHaveLength(5)
})

it('syncs mutations between clients', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
    email: o.text(),
  })

  // Single RemoteDb wrapping the server
  const { remoteDb } = await _makeRemoteDb({ users })

  // Client 1: insert user with mutation
  const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

  // Insert a user
  const inserted = await client1.users.insertWithUndo({ name: 'Charlie', email: 'charlie@example.com' })
  const userId = inserted.id

  // Verify insert worked locally on client1
  let client1Result = await client1.users.select().execute()
  expect(client1Result).toHaveLength(1)

  // Client 2: initialize and should receive insert mutation from client 1
  const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

  // Verify sync state (should be synced after blocking initial sync)
  expect(client2.syncState).toBe('synced')

  // Wait for background sync to complete

  expect(client2.syncState).toBe('synced')

  let result = await client2.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Charlie', email: 'charlie@example.com' }
  ])

  // Update the user from client1
  await client1.users.updateWithUndo({
    data: { email: 'charlie.updated@example.com' },
    where: { id: userId }
  })

  // Client 3: initialize and should receive both insert and update mutations
  const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

  // Wait for background sync to complete

  result = await client3.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Charlie', email: 'charlie.updated@example.com' }
  ])

  // Delete the user from client1
  await client1.users.deleteWithUndo({ where: { id: userId } })

  // Client 4: initialize and should have empty table (insert, update, then delete)
  const { db: client4, driver: client4Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client4' })

  // Wait for background sync to complete

  // Verify all 3 mutations were received
  const client4Mutations = await client4Driver.run({
    query: 'SELECT id, value FROM _db_mutations_queue ORDER BY server_timestamp_ms',
    params: [],
  })
  expect(client4Mutations).toHaveLength(3)
  expect(client4Mutations.map((m: any) => JSON.parse(m.value).mutation[0].type)).toEqual(['insert', 'update', 'delete'])

  // After all mutations applied (insert -> update -> delete), table should be empty
  result = await client4.users.select().execute()
  expect(result).toHaveLength(0)
})

describe('RemoteDbClient and RemoteDbServer', () => {
  it('syncs data through HTTP client/server', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    // Create server
    const { db: serverDb, remoteDb } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Client sends mutation
    const userId = ulid()
    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: userId, name: 'Charlie', email: 'charlie@example.com' }],
          undo: { type: 'delete', ids: [userId] },
        },
      ],
      node: { id: ulid(), name: 'client1' },
    }

    const sendResult = await remoteDb.send([batch])
    expect(sendResult.succeeded).toHaveLength(1)
    expect(sendResult.failed).toHaveLength(0)

    // Verify data on server
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toMatchObject([
      { name: 'Charlie', email: 'charlie@example.com' }
    ])

    // Client retrieves mutations
    const mutations = await remoteDb.get(0)
    expect(mutations).toHaveLength(1)
    expect(mutations[0].batch).toMatchObject({
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: userId, name: 'Charlie', email: 'charlie@example.com' }]
        }
      ]
    })
  })

  it('pulls initial data through HTTP client/server', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Create server with data
    const { db: serverDb, remoteDb } = await _makeHttpRemoteDb({ users })
    await serverDb.users.insertMany([
      { name: 'Alice' },
      { name: 'Bob' }
    ])

    // Create local client
    const { db: client } = await _makeClientDb({ users }, remoteDb, { skipPull: false, debugName: 'client1' })

    // Verify data pulled
    const result = await client.users.select().execute()
    expect(result).toHaveLength(2)
    expect(result.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
  })
})

it('clears all user and internal tables', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
    email: o.text(),
  })

  const posts = o.table('posts', {
    id: o.id(),
    title: o.text(),
  })

  const { db: serverDb, remoteDb } = await _makeRemoteDb({ users, posts })
  await serverDb.users.insertMany([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
  ])
  await serverDb.posts.insertMany([
    { title: 'Post 1' },
    { title: 'Post 2' }
  ])

  const { db: client, driver: clientDriver } = await _makeClientDb({ users, posts }, remoteDb, { skipPull: false, debugName: 'client1' })

  // Make mutations to populate internal tables
  await client.users.insertWithUndo({ name: 'Charlie', email: 'charlie@example.com' })
  await client.posts.insertWithUndo({ title: 'Post 3' })

  // Verify data exists in user tables
  const usersBefore = await client.users.select().execute()
  expect(usersBefore).toHaveLength(3)

  // Verify data exists in internal tables
  const mutationQueueBefore = await clientDriver.run({
    query: 'SELECT * FROM _db_mutations_queue',
    params: [],
  })
  expect(mutationQueueBefore.length).toBeGreaterThan(0)

  const pullProgressBefore = await clientDriver.run({
    query: 'SELECT * FROM _sync_pull_progress',
    params: [],
  })
  expect(pullProgressBefore).toHaveLength(2) // users and posts

  const syncNodeBefore = await clientDriver.run({
    query: 'SELECT * FROM _sync_node',
    params: [],
  })
  expect(syncNodeBefore).toHaveLength(1)

  // Clear the database
  await client._clear()

  // Verify user tables are empty
  const usersAfter = await client.users.select().execute()
  const postsAfter = await client.posts.select().execute()
  expect(usersAfter).toHaveLength(0)
  expect(postsAfter).toHaveLength(0)

  // Verify internal tables are empty
  const mutationQueueAfter = await clientDriver.run({
    query: 'SELECT * FROM _db_mutations_queue',
    params: [],
  })
  expect(mutationQueueAfter).toHaveLength(0)

  const pullProgressAfter = await clientDriver.run({
    query: 'SELECT * FROM _sync_pull_progress',
    params: [],
  })
  expect(pullProgressAfter).toHaveLength(0)

  const syncNodeAfter = await clientDriver.run({
    query: 'SELECT * FROM _sync_node',
    params: [],
  })
  expect(syncNodeAfter).toHaveLength(0)
})

it('derived tables work with synced db - full and incremental revalidation', async () => {
  const mutations = o.table('mutations', {
    id: o.id(),
    entityId: o.text().notNull(),
    delta: o.integer().notNull()
  })

  const states = o.derivedTable('states', {
    entityId: o.text().notNull().primaryKey(),
    total: o.integer().notNull()
  })

  // Server only has mutations table (states is client-only)
  const { db: serverDb, remoteDb } = await _makeRemoteDb({ mutations })

  // Insert initial mutations on server
  const entityId1 = 'entity1'
  const entityId2 = 'entity2'
  await serverDb.mutations.insertMany([
    { entityId: entityId1, delta: 10 },
    { entityId: entityId1, delta: 5 },
    { entityId: entityId2, delta: 20 }
  ])

  // Create client with derived table
  const { db } = await _makeClientDb({ mutations, states }, remoteDb, {
    skipPull: false,
    debugName: 'client1'
  })

  // Track derivation calls
  let fullCalls = 0
  let incrementalCalls: Array<{ type: 'insert' | 'update' | 'delete', ids: string[] }> = []

  // Define derivation logic
  db.states.derive(async (context: DerivationContext) => {
    if (context.type === 'full') {
      fullCalls++
      await db.states.deleteAll()

      const allMutations = await db.mutations.select().execute()
      const totals = new Map<string, number>()

      for (const mut of allMutations) {
        const current = totals.get(mut.entityId) ?? 0
        totals.set(mut.entityId, current + mut.delta)
      }

      for (const [entityId, total] of totals) {
        await db.states.insert({ entityId, total })
      }
    } else {
      incrementalCalls.push({ type: context.mutationType, ids: context.ids })

      // For delete operations, we need to handle differently since the deleted mutations
      // are already gone. For simplicity in this test, we'll do a full recomputation.
      // In production, you'd want to track entity IDs before deletion.
      if (context.mutationType === 'delete') {
        // Full recomputation for deletes
        await db.states.deleteAll()

        const allMutations = await db.mutations.select().execute()
        const totals = new Map<string, number>()

        for (const mut of allMutations) {
          const current = totals.get(mut.entityId) ?? 0
          totals.set(mut.entityId, current + mut.delta)
        }

        for (const [entityId, total] of totals) {
          await db.states.insert({ entityId, total })
        }
      } else {
        // For insert/update: recalculate only affected entities
        const affectedMuts = await db.mutations
          .select()
          .execute()

        // Find affected entity IDs from the mutations
        const affectedEntityIds = new Set<string>()
        for (const mut of affectedMuts) {
          if (context.ids.includes(mut.id)) {
            affectedEntityIds.add(mut.entityId)
          }
        }

        for (const entityId of affectedEntityIds) {
          const entityMuts = await db.mutations
            .select()
            .execute()
            .then(muts => muts.filter(m => m.entityId === entityId))

          const total = entityMuts.reduce((sum, m) => sum + m.delta, 0)

          // Upsert the total
          const existing = await db.states.select().execute().then(states => states.filter(s => s.entityId === entityId))
          if (existing.length > 0) {
            await db.states.update({ data: { total }, where: sql`entity_id = ${entityId}` })
          } else {
            await db.states.insert({ entityId, total })
          }
        }
      }
    }
  }, [db.mutations])

  // Manually trigger initial revalidation now that derive() is set up
  await db.revalidateDerivedTables(undefined, { type: 'full' })

  // Check initial state after full sync
  expect(fullCalls).toBe(1)
  expect(incrementalCalls).toHaveLength(0)

  const initialStates = await db.states.select().execute()
  expect(initialStates).toHaveLength(2)
  expect(initialStates.find(s => s.entityId === entityId1)?.total).toBe(15) // 10 + 5
  expect(initialStates.find(s => s.entityId === entityId2)?.total).toBe(20)

  // Now add a new mutation locally - this should trigger incremental revalidation
  const inserted = await db.mutations.insertWithUndo({ entityId: entityId1, delta: 7 })
  const insertedId = inserted.id

  // Wait for incremental revalidation to complete and state to update
  await vi.waitFor(async () => {
    const updatedStates = await db.states.select().execute()
    expect(updatedStates.find(s => s.entityId === entityId1)?.total).toBe(22) // 10 + 5 + 7
  })

  // Check incremental revalidation was called
  expect(incrementalCalls.length).toBeGreaterThan(0)
  expect(incrementalCalls[incrementalCalls.length - 1].type).toBe('insert')
  expect(incrementalCalls[incrementalCalls.length - 1].ids).toContain(insertedId)

  // Update a mutation - should trigger incremental update
  const allMuts = await db.mutations.select().execute()
  const mutToUpdate = allMuts.find(m => m.entityId === entityId2)!
  await db.mutations.updateWithUndo({
    data: { delta: 25 },
    where: { id: mutToUpdate.id }
  })

  await vi.waitFor(async () => {
    const afterUpdateStates = await db.states.select().execute()
    expect(afterUpdateStates.find(s => s.entityId === entityId2)?.total).toBe(25)
  })

  // Delete a mutation - should trigger incremental delete
  await db.mutations.deleteWithUndo({ where: { id: mutToUpdate.id } })

  await vi.waitFor(async () => {
    const afterDeleteStates = await db.states.select().execute()
    // After deleting all mutations for entityId2, there should be no state row for it
    expect(afterDeleteStates.find(s => s.entityId === entityId2)).toBeUndefined()
  })
})
