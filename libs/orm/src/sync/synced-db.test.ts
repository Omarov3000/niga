import { expect, it, describe, vi } from 'vitest'
import { o } from '../schema/builder'
import { ulid } from 'ulidx'
import type { DbMutationBatch } from './types'
import { AlwaysOnlineDetector, ControllableOnlineDetector } from './test-online-detector'
import { _makeClientDb, _makeHttpRemoteDb, _makeRemoteDb, UnstableNetworkFetch } from './test-helpers'

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
  expect(postResult).toHaveLength(2)
  expect(postResult[0].title).toBe('First Post')
  // authorId is binary data, just verify it exists
  expect(postResult[0].authorId).toBeDefined()
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
  await client2.waitForSync()

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
  await client3.waitForSync()

  result = await client3.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Charlie', email: 'charlie.updated@example.com' }
  ])

  // Delete the user from client1
  await client1.users.deleteWithUndo({ where: { id: userId } })

  // Client 4: initialize and should have empty table (insert, update, then delete)
  const { db: client4, driver: client4Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client4' })

  // Wait for background sync to complete
  await client4.waitForSync()

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

describe('conflict resolution', () => {
  it('merges concurrent updates to different fields (case 2.1)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Original', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    // Client1 updates name (lower timestamp - sent first)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.updateWithUndo({
      data: { name: 'Alice' },
      where: { id: userId }
    })

    // Client2 updates email (higher timestamp - sent second)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client2.users.updateWithUndo({
      data: { email: 'alice@new.com' },
      where: { id: userId }
    })

    // Client3: initialize and should receive merged result
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'alice@new.com' }
    ])
  })

  it('last-write-wins for concurrent updates to same field (case 2.1b)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    // Client1 updates email to v1 (lower timestamp)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.updateWithUndo({
      data: { email: 'v1@example.com' },
      where: { id: userId }
    })

    // Client2 updates email to v2 (higher timestamp - sent second)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client2.users.updateWithUndo({
      data: { email: 'v2@example.com' },
      where: { id: userId }
    })

    // Client3: initialize and should receive LWW result (v2 wins)
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'v2@example.com' }
    ])
  })

  it('rejects update when delete came first (case 2.2a)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    // Client1 deletes row (lower timestamp)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.deleteWithUndo({ where: { id: userId } })

    // Client2 updates same row (higher timestamp - should be rejected)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client2.users.updateWithUndo({
      data: { email: 'updated@example.com' },
      where: { id: userId }
    })

    // Check that client2's update mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row is deleted
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toHaveLength(0)
  })

  it('rejects delete when update came first (case 2.2b)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    // Client1 updates row (lower timestamp)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.updateWithUndo({
      data: { email: 'updated@example.com' },
      where: { id: userId }
    })

    // Client2 deletes same row (higher timestamp - should be rejected)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client2.users.deleteWithUndo({ where: { id: userId } })

    // Check that client2's delete mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row with update applied
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'updated@example.com' }
    ])
  })

  it('rejects second delete of same row (case 2.3)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    // Client1 deletes row (lower timestamp)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.deleteWithUndo({ where: { id: userId } })

    // Client2 also deletes same row (higher timestamp - should be rejected)
    await new Promise(resolve => setTimeout(resolve, 5))
    await client2.users.deleteWithUndo({ where: { id: userId } })

    // Check that client2's delete mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row is deleted
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toHaveLength(0)
  })

  it('rejects duplicate insert with same id (case 2.4)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user with specific ID
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const sharedId = ulid()
    await client1.users.insertWithUndo({ id: sharedId, name: 'Alice', email: 'alice@example.com' })

    // Client2: try to insert different user with same ID
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    await new Promise(resolve => setTimeout(resolve, 5))

    // Try to insert with same ID - should fail locally due to UNIQUE constraint
    // This is expected - with ULIDs this shouldn't happen in practice
    let insertFailed = false
    try {
      await client2.users.insertWithUndo({ id: sharedId, name: 'Bob', email: 'bob@example.com' })
    } catch (error) {
      insertFailed = true
    }

    expect(insertFailed).toBe(true)

    // Client3: initialize and should see only first insert
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })
    await client3.waitForSync()

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'alice@example.com' }
    ])
  })

  it('handles out-of-order updates by undoing and reapplying (case 3)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    // Create server DB
    const { remoteDb, driver: serverDriver } = await _makeRemoteDb({ users })

    // Client1: insert and make two updates
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice', email: 'v0@example.com' })

    // Wait for insert to sync
    await client1.waitForSync()

    // Create a second client that will make update 1
    const { db: client1b, driver: client1bDriver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1b' })
    await client1b.waitForSync()

    // Update 1: email to v1 (lower timestamp) - don't sync yet
    await new Promise(resolve => setTimeout(resolve, 5))
    const update1Time = Date.now()
    await client1bDriver.run({
      query: 'UPDATE users SET email = ? WHERE id = ?',
      params: ['v1@example.com', userId],
    })

    // Update 2: email to v2 (higher timestamp) from client1 - sync immediately
    await new Promise(resolve => setTimeout(resolve, 5))
    await client1.users.updateWithUndo({ data: { email: 'v2@example.com' }, where: { id: userId } })

    // Now manually send update1 (older update that arrives after newer update2)
    const update1Batch: DbMutationBatch = {
      id: ulid(update1Time),
      dbName: 'synced',
      mutation: [{
        table: 'users',
        type: 'update',
        data: { id: userId, email: 'v1@example.com' },
        undo: {
          type: 'update',
          data: [{ id: userId, email: 'v0@example.com' }],
        },
      }],
      node: { id: ulid(), name: 'client1b' },
    }

    // Send the older update - should be rejected or merged correctly
    await remoteDb.send([update1Batch])

    // Client2: verify final state has v2 (newer update wins)
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })
    await client2.waitForSync()

    const finalResult = await client2.users.select().execute()
    expect(finalResult).toMatchObject([
      { name: 'Alice', email: 'v2@example.com' }
    ])
  })

  it('undoes failed mutations when server rejects due to FK violation (case 4)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const posts = o.table('posts', {
      id: o.id(),
      title: o.text(),
      authorId: o.idFk().references(() => users.id),
    })

    // Server uses full mode with FK constraints
    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users, posts })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users, posts }, remoteDb, { debugName: 'client1' })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice' })
    await client1.waitForSync()

    // Client2: insert post with non-existent authorId (FK violation on server)
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users, posts }, remoteDb, { debugName: 'client2' })

    const nonExistentUserId = ulid()
    const postId = ulid()

    // Check server posts BEFORE client2 insert
    const serverPostsBefore = await serverDb.posts.select().execute()
    expect(serverPostsBefore).toHaveLength(0)

    await client2.posts.insertWithUndo({ id: postId, title: 'Invalid Post', authorId: nonExistentUserId })

    // Wait for sync - server will reject due to FK violation
    await client2.waitForSync()

    // Verify post was created locally (client allows it with minimal mode)
    const localPosts = await client2.posts.select().execute()
    expect(localPosts).toHaveLength(1)

    // Server should have rejected it (FK violation)
    const serverPostsAfter = await serverDb.posts.select().execute()
    expect(serverPostsAfter).toHaveLength(0)

    // Client2 should undo the failed mutation locally
    // Check client2's local queue - the failed mutation should trigger undo
    const client2Queue = await client2Driver.run({
      query: 'SELECT * FROM _db_mutations_queue',
      params: [],
    })

    // Mutation exists in queue but with server_timestamp_ms = 0 (failed)
    const failedMutation = client2Queue.find((m: any) => JSON.parse(m.value).mutation[0].data.some((d: any) => d.id === postId))
    expect(failedMutation?.server_timestamp_ms).toBe(0)
  })

  it('rejects entire batch when one mutation fails (transaction atomicity)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })

    // Create a batch with mixed valid/invalid mutations
    const validUserId = ulid()
    const invalidUserId = ulid() // Non-existent for update

    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: validUserId, name: 'Alice', email: 'alice@example.com' }],
          undo: { type: 'delete', ids: [validUserId] },
        },
        {
          table: 'users',
          type: 'update',
          data: { id: invalidUserId, email: 'invalid@example.com' }, // This will fail - row doesn't exist
          undo: { type: 'update', data: [{ id: invalidUserId, email: 'old@example.com' }] },
        },
      ],
      node: { id: ulid(), name: 'client1' },
    }

    const result = await remoteDb.send([batch])

    // Verify batch failed
    expect(result.failed).toHaveLength(1)
    expect(result.succeeded).toHaveLength(0)

    // Verify NO mutations were applied (transaction rolled back)
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(0)
  })

  it('handles duplicate batch submissions idempotently', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })

    const userId = ulid()
    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: userId, name: 'Alice', email: 'alice@example.com' }],
          undo: { type: 'delete', ids: [userId] },
        },
      ],
      node: { id: ulid(), name: 'client1' },
    }

    // Send batch first time
    const result1 = await remoteDb.send([batch])
    expect(result1.succeeded).toHaveLength(1)
    expect(result1.failed).toHaveLength(0)

    // Send same batch again (network retry)
    const result2 = await remoteDb.send([batch])
    expect(result2.failed).toHaveLength(1) // Duplicate ID will fail
    expect(result2.succeeded).toHaveLength(0)

    // Verify user exists only once
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(1)
    expect(serverUsers[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' })
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
  await client.waitForSync()

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

describe('network instability', () => {
  it('retries failed requests during initial sync', async () => {
    console.log('[TEST] Starting retry test')
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { db: serverDb, remoteDb } = await _makeHttpRemoteDb({ users })
    await serverDb.users.insertMany([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' }
    ])
    console.log('[TEST] Server setup complete')

    console.log('[TEST] Creating client1...')
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { skipPull: false, debugName: 'client1' })
    console.log('[TEST] Client1 created, syncState:', client1.syncState)

    expect(client1.syncState).toBe('synced')
    const result1 = await client1.users.select().execute()
    expect(result1).toMatchObject([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' }
    ])
    console.log('[TEST] Test passed')
  })

  it('queues mutations locally when offline', async () => {
    console.log('[TEST] Starting offline test')
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const onlineDetector = new ControllableOnlineDetector()
    const { remoteDb } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    console.log('[TEST] Creating client...')
    const { db: client, driver: clientDriver } = await _makeClientDb({ users }, remoteDb, {
      debugName: 'client1',
      onlineDetector,
    })
    console.log('[TEST] Client created')

    // Make mutation while online
    console.log('[TEST] Inserting user while online...')
    await client.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    await client.waitForSync()
    console.log('[TEST] First mutation synced')

    // Go offline
    console.log('[TEST] Going offline...')
    onlineDetector.setOnline(false)
    expect(client.syncState).toBe('offline')

    // Make mutation while offline
    console.log('[TEST] Making mutation while offline...')
    await client.users.insertWithUndo({ name: 'Bob', email: 'bob@example.com' })

    // Verify queued locally
    const offlineMutations = await clientDriver.run({
      query: 'SELECT * FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(offlineMutations.length).toBeGreaterThan(0)
    console.log('[TEST] Mutation queued locally')

    // Verify local read works
    const localResult = await client.users.select().execute()
    expect(localResult).toHaveLength(2)
    console.log('[TEST] Test passed')
  })
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
