import { expect, it, describe, vi } from 'vitest'
import { o } from '../schema/builder'
import { ulid } from 'ulidx'
import type { DbMutationBatch } from './types'
import { AlwaysOnlineDetector, ControllableOnlineDetector } from './test-online-detector'
import { _makeClientDb, _makeHttpRemoteDb, _makeRemoteDb, UnstableNetworkFetch } from './test-helpers'
import { RemoteDbClient } from './remote-db'
import { createFetchWrapper } from './fetch-wrapper'

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
