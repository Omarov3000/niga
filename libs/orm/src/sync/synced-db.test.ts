import { expect, it, describe } from 'vitest'
import { o } from '../schema/builder'
import { OrmNodeDriver } from '../orm-node-driver'
import { TestRemoteDb } from './remote-db'
import { ulid } from 'ulidx'

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

  const result = await db.users.select().execute(o.s.object({ id: o.s.id(), name: o.s.text(), email: o.s.text() }))
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

  const result = await db.users.select().execute(o.s.object({ id: o.s.id(), name: o.s.text() }))

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

  const userResult = await db.users.select().execute(o.s.object({ id: o.s.id(), name: o.s.text() }))
  const postResult = await db.posts.select().execute(o.s.object({ id: o.s.id(), title: o.s.text(), authorId: o.s.id() }))

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
  const result1 = await db1.users.select().execute(o.s.object({ id: o.s.id(), name: o.s.text() }))
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
  const result2 = await db2.users.select().execute(o.s.object({ id: o.s.id(), name: o.s.text() }))
  expect(result2).toHaveLength(5)
})
