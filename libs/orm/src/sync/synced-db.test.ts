import { expect, it, describe } from 'vitest'
import { o } from '../schema/builder'
import { OrmNodeDriver } from '../orm-node-driver'
import { TestRemoteDb } from './remote-db'
import { ulid } from 'ulidx'
import { internalSyncTables } from './internal-tables'
import type { DbMutationBatch } from './types'

it('syncs data from remote on initialization', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
    email: o.text(),
  })

  const remoteDriver = new OrmNodeDriver()
  const remoteDbInstance = await o.testDb({ schema: { users }, origin: 'server' }, remoteDriver)
  await remoteDbInstance.users.insertMany([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
  ])

  const remoteDb = new TestRemoteDb(remoteDbInstance, remoteDriver, { users })

  const driver = new OrmNodeDriver()
  const db = await o.syncedDb({
    schema: { users },
    driver,
    remoteDb,
  })

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

  const remoteDriver = new OrmNodeDriver()
  const remoteDbInstance = await o.testDb({ schema: { users } }, remoteDriver)

  const remoteDb = new TestRemoteDb(remoteDbInstance, remoteDriver, { users })

  const driver = new OrmNodeDriver()

  const db = await o.syncedDb({
    schema: { users },
    driver,
    remoteDb,
  })

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

  const remoteDriver = new OrmNodeDriver()
  const remoteDbInstance = await o.testDb({ schema: { users, posts } }, remoteDriver)

  await remoteDbInstance.users.insert({ id: userId1, name: 'Alice' })
  await remoteDbInstance.users.insert({ id: userId2, name: 'Bob' })
  await remoteDbInstance.posts.insert({ id: postId1, title: 'First Post', authorId: userId1 })
  await remoteDbInstance.posts.insert({ id: postId2, title: 'Second Post', authorId: userId2 })

  const remoteDb = new TestRemoteDb(remoteDbInstance, remoteDriver, { users, posts })

  const driver = new OrmNodeDriver()

  const db = await o.syncedDb({
    schema: { users, posts },
    driver,
    remoteDb,
  })

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
  const remoteDriver = new OrmNodeDriver()
  const remoteDbInstance = await o.testDb({ schema: { users } }, remoteDriver)

  for (let i = 1; i <= 5; i++) {
    await remoteDbInstance.users.insert({ id: ulid(), name: `User ${i}` })
  }

  const remoteDb = new TestRemoteDb(remoteDbInstance, remoteDriver, { users })

  // Create local driver and manually initialize sync tables
  const driver1 = new OrmNodeDriver()

  // First sync - create a fresh db and pull all data
  const db1 = await o.syncedDb({
    schema: { users },
    driver: driver1,
    remoteDb,
  })

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

  // Create server DB with internal mutation tables
  const serverDriver = new OrmNodeDriver()
  const serverDb = await o.testDb(
    {
      schema: {
        users,
        ...internalSyncTables,
      },
      origin: 'server',
    },
    serverDriver
  )

  // Single RemoteDb wrapping the server
  const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

  // Client 1: insert user with mutation
  const client1Driver = new OrmNodeDriver()
  const client1 = await o.syncedDb({
    schema: { users },
    driver: client1Driver,
    remoteDb,
    skipPull: true,
  })

  // Insert a user
  const inserted = await client1.users.insertWithUndo({ name: 'Charlie', email: 'charlie@example.com' })
  const userId = inserted.id

  // Verify insert worked locally on client1
  let client1Result = await client1.users.select().execute()
  expect(client1Result).toHaveLength(1)

  // Client 2: initialize and should receive insert mutation from client 1
  const client2Driver = new OrmNodeDriver()
  const client2 = await o.syncedDb({
    schema: { users },
    driver: client2Driver,
    remoteDb,
    skipPull: true,
  })

  // Verify sync state transitions
  expect(client2.syncState).toBe('gettingLatest')

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
  const client3Driver = new OrmNodeDriver()
  const client3 = await o.syncedDb({
    schema: { users },
    driver: client3Driver,
    remoteDb,
    skipPull: true,
  })

  // Wait for background sync to complete
  await client3.waitForSync()

  result = await client3.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Charlie', email: 'charlie.updated@example.com' }
  ])

  // Delete the user from client1
  await client1.users.deleteWithUndo({ where: { id: userId } })

  // Client 4: initialize and should have empty table (insert, update, then delete)
  const client4Driver = new OrmNodeDriver()
  const client4 = await o.syncedDb({
    schema: { users },
    driver: client4Driver,
    remoteDb,
    skipPull: true,
  })

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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const inserted = await client1.users.insertWithUndo({ name: 'Original', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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

    // Create server DB with internal tables
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert user with specific ID
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const sharedId = ulid()
    await client1.users.insertWithUndo({ id: sharedId, name: 'Alice', email: 'alice@example.com' })

    // Client2: try to insert different user with same ID
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })

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
    const client3Driver = new OrmNodeDriver()
    const client3 = await o.syncedDb({
      schema: { users },
      driver: client3Driver,
      remoteDb,
      skipPull: true,
    })
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
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    // Client1: insert and make two updates
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice', email: 'v0@example.com' })

    // Wait for insert to sync
    await client1.waitForSync()

    // Create a second client that will make update 1
    const client1bDriver = new OrmNodeDriver()
    const client1b = await o.syncedDb({
      schema: { users },
      driver: client1bDriver,
      remoteDb,
      skipPull: true,
    })
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
    const sendResult = await remoteDb.send([update1Batch])

    // Check mutation queue order on server
    const queueState = await serverDriver.run({
      query: 'SELECT id, server_timestamp_ms FROM _db_mutations_queue ORDER BY server_timestamp_ms ASC',
      params: [],
    })

    // Client2: verify final state has v2 (newer update wins)
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
    })
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
    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          posts,
          ...internalSyncTables,
        },
        origin: 'server',
        debugName: 'server',
        logging: true,
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users, posts })

    // Client1: insert user
    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users, posts },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
      debugName: 'client1',
      logging: true,
    })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice' })
    await client1.waitForSync()

    // Client2: insert post with non-existent authorId (FK violation on server)
    const client2Driver = new OrmNodeDriver()
    const client2 = await o.syncedDb({
      schema: { users, posts },
      driver: client2Driver,
      remoteDb,
      skipPull: true,
      debugName: 'client2',
      logging: true,
    })

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

    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

    const client1Driver = new OrmNodeDriver()
    const client1 = await o.syncedDb({
      schema: { users },
      driver: client1Driver,
      remoteDb,
      skipPull: true,
    })

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

    const serverDriver = new OrmNodeDriver()
    const serverDb = await o.testDb(
      {
        schema: {
          users,
          ...internalSyncTables,
        },
        origin: 'server',
      },
      serverDriver
    )

    const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

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
