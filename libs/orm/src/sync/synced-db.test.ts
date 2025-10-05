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
