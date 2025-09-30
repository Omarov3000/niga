import { test, expect } from 'vitest'
import { b } from '@w/bin'
import {BinMigratingBrowserDriver } from './bin-migrating-browser-driver'

test('creates tables on first use', async () => {
  const users = b.table('users', {
    id: b.integer().primaryKey(),
    name: b.text(),
  })

  const bin = b.db({ schema: { users } })
  const driver = new BinMigratingBrowserDriver(bin)

  const result = await driver.run({ query: 'SELECT COUNT(*) as count FROM users', params: [] })

  expect(result).toMatchObject([{ count: 0 }])

  // Verify migrations table was created
  const tables = await driver.run({
    query: 'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name',
    params: []
  })

  const tableNames = tables.map((row: any) => row.name)
  expect(tableNames).toContain('_migrations')
  expect(tableNames).toContain('users')
})

test('handles schema changes', async () => {
  const users = b.table('users', {
    id: b.integer().primaryKey(),
    name: b.text(),
  })

  // First migration with users table
  const initialBin = b.db({ schema: { users } })
  const driver1 = new BinMigratingBrowserDriver(initialBin, ':memory:')

  await driver1.run({ query: 'SELECT COUNT(*) FROM users', params: [] })

  // Second migration adding posts table
  const posts = b.table('posts', {
    id: b.integer().primaryKey(),
    title: b.text(),
    userId: b.integer(),
  })

  const updatedBin = b.db({ schema: { users, posts } })
  const driver2 = new BinMigratingBrowserDriver(updatedBin, ':memory:')

  await driver2.run({ query: 'SELECT COUNT(*) FROM posts', params: [] })

  // Verify both tables exist
  const tables = await driver2.run({
    query: 'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name',
    params: []
  })

  const tableNames = tables.map((row: any) => row.name)
  expect(tableNames).toContain('users')
  expect(tableNames).toContain('posts')
})

test('handles initialization errors', async () => {
  const users = b.table('users', {
    id: b.integer().primaryKey(),
    name: b.text(),
  })

  const bin = b.db({ schema: { users } })
  const driver = new BinMigratingBrowserDriver(bin, '/invalid/path')

  await expect(driver.run({ query: 'SELECT 1', params: [] })).rejects.toThrow()
})

test('calls onInit callback', async () => {
  const users = b.table('users', {
    id: b.integer().primaryKey(),
    name: b.text(),
  })

  const bin = b.db({ schema: { users } })

  let initCallbackCalled = false
  let callbackDriver = null

  const driver = new BinMigratingBrowserDriver(
    bin,
    ':memory:',
    (browserDriver) => {
      initCallbackCalled = true
      callbackDriver = browserDriver
    }
  )

  await driver.run({ query: 'SELECT COUNT(*) FROM users', params: [] })

  expect(initCallbackCalled).toBe(true)
  expect(callbackDriver).toBeTruthy()
})

test('basic operations work', async () => {
  const users = b.table('users', {
    id: b.integer().primaryKey(),
    name: b.text(),
  })

  const bin = b.db({ schema: { users } })
  const driver = new BinMigratingBrowserDriver(bin)

  // Insert data using exec
  await driver.exec('INSERT INTO users (id, name) VALUES (1, \'Alice\')')
  await driver.exec('INSERT INTO users (id, name) VALUES (2, \'Bob\')')

  // Query data using run
  const result = await driver.run({
    query: 'SELECT name FROM users WHERE id = ?',
    params: [1]
  })

  expect(result).toMatchObject([{ name: 'Alice' }])

  // Test batch operations
  const batchResults = await driver.batch([
    { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [3, 'Charlie'] },
    { query: 'SELECT COUNT(*) as count FROM users', params: [] }
  ])

  expect(batchResults[1]).toMatchObject([{ count: 3 }])
})
