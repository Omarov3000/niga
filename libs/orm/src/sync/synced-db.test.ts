import { expect, it, describe } from 'vitest'
import { o } from '../schema/builder'
import { OrmNodeDriver } from '../orm-node-driver'
import { TestRemoteDb } from './remote-db'
import { ulid } from 'ulidx'
import { internalSyncTables } from './internal-tables'

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

  // Case 2.2a: update vs delete (update comes later)
  // - Client1 deletes row
  // - Client2 updates same row (higher timestamp)
  // - Server rejects later update mutation
  // - Verify row stays deleted, mutation in failed queue

  // Case 2.2b: delete vs update (delete comes later)
  // - Client1 updates row
  // - Client2 deletes same row (higher timestamp)
  // - Server rejects later delete mutation
  // - Verify row exists with update applied, mutation in failed queue

  // Case 2.3: delete vs delete
  // - Client1 deletes row
  // - Client2 deletes same row (higher timestamp)
  // - First delete succeeds, second rejected
  // - Verify row deleted, second mutation rejected

  // Case 2.4: insert vs insert (impossible - unique ids)
  // - Client1 inserts row with id=X
  // - Client2 inserts different row with same id=X (shouldn't happen with ulid)
  // - Second insert rejected
  // - Verify only first insert exists

  // Case 3: out-of-order mutations (update before insert)
  // - Client1 inserts row at t=100
  // - Client1 updates row at t=200
  // - Server receives update first (network reordering)
  // - Server detects out-of-order by ulid
  // - Server undoes update, waits for insert, re-applies both
  // - Verify final state has both insert+update applied correctly

  // Case 4: cross-device FK violation
  // - Client1 inserts user X
  // - Client2 (not synced) inserts post Y referencing user X
  // - Post mutation arrives at server before user mutation
  // - Server rejects post mutation (FK violation)
  // - Verify post mutation in failed queue, user inserted successfully

  // Batch rejection test
  // - Create batch with [insert valid, update invalid (non-existent row), delete valid]
  // - Send batch to server
  // - Verify entire batch rejected (transaction atomicity)
  // - Verify none of the mutations applied

  // Idempotency test
  // - Client sends mutation batch
  // - Network retries same batch
  // - Server detects duplicate by batch.id
  // - Verify mutation applied only once, no errors on retry
})
