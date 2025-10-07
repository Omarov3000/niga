import { test, expect } from 'vitest'
import { o } from './builder'
import { OrmMigratingDriver } from './orm-migrating-driver'
import { OrmNodeDriver } from '../orm-node-driver'

test('creates tables on first use', async () => {
  const users = o.table('users', {
    id: o.integer().primaryKey(),
    name: o.text(),
  })

  const db = o.db({ schema: { users } })
  const innerDriver = new OrmNodeDriver()
  const driver = new OrmMigratingDriver(innerDriver, db)

  const result = await driver.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })

  expect(result).toMatchObject([{ count: 0 }])

  const tables = await driver.run({
    query: 'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name',
    params: []
  })

  const tableNames = tables.map((row: any) => row.name)
  expect(tableNames).toContain('_migrations')
  expect(tableNames).toContain('users')
})

test('skips migration when schema unchanged', async () => {
  const users = o.table('users', {
    id: o.integer().primaryKey(),
    name: o.text(),
  })

  const db = o.db({ schema: { users } })
  const innerDriver = new OrmNodeDriver()
  const driver1 = new OrmMigratingDriver(innerDriver, db)

  await driver1.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })

  const driver2 = new OrmMigratingDriver(innerDriver, db)

  const result = await driver2.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })
  expect(result).toMatchObject([{ count: 0 }])
})

test('handles schema changes', async () => {
  const users = o.table('users', {
    id: o.integer().primaryKey(),
    name: o.text(),
  })

  const db1 = o.db({ schema: { users } })
  const innerDriver1 = new OrmNodeDriver()
  const driver1 = new OrmMigratingDriver(innerDriver1, db1)

  await driver1.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })

  const posts = o.table('posts', {
    id: o.integer().primaryKey(),
    title: o.text(),
    userId: o.integer(),
  })

  const db2 = o.db({ schema: { users, posts } })
  const innerDriver2 = new OrmNodeDriver()
  const driver2 = new OrmMigratingDriver(innerDriver2, db2)

  await driver2.run({ query: 'SELECT COUNT(*) as count FROM posts', params: [] })

  const tables = await driver2.run({
    query: 'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name',
    params: []
  })

  const tableNames = tables.map((row: any) => row.name)
  expect(tableNames).toContain('users')
  expect(tableNames).toContain('posts')
})

test('basic operations work', async () => {
  const users = o.table('users', {
    id: o.integer().primaryKey(),
    name: o.text(),
  })

  const db = o.db({ schema: { users } })
  const innerDriver = new OrmNodeDriver()
  const driver = new OrmMigratingDriver(innerDriver, db)

  await driver.exec('INSERT INTO users (id, name) VALUES (1, \'Alice\')')
  await driver.exec('INSERT INTO users (id, name) VALUES (2, \'Bob\')')

  const result = await driver.run({
    query: 'SELECT name FROM users WHERE id = ?',
    params: [1]
  })

  expect(result).toMatchObject([{ name: 'Alice' }])

  const batchResults = await driver.batch([
    { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [3, 'Charlie'] },
    { query: 'SELECT COUNT(*) as count FROM users', params: [] }
  ])

  expect(batchResults[1]).toMatchObject([{ count: 3 }])
})

test('transaction support works', async () => {
  const users = o.table('users', {
    id: o.integer().primaryKey(),
    name: o.text(),
  })

  const db = o.db({ schema: { users } })
  const innerDriver = new OrmNodeDriver()
  const driver = new OrmMigratingDriver(innerDriver, db)

  const tx = await driver.beginTransaction()

  await tx.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] })
  await tx.commit()

  const result = await driver.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })
  expect(result).toMatchObject([{ count: 1 }])
})
