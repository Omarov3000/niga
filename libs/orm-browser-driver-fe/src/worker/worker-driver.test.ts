import { describe, it, expect } from 'vitest'
import { o } from '@w/orm'
import { OrmMigratingBrowserDriver } from '../orm-migrating-browser-driver'

describe('Worker Driver', () => {
  it('should execute queries in worker thread via OrmMigratingBrowserDriver', async () => {
    const users = o.table(
      'users',
      {
        id: o.integer().primaryKey(),
        name: o.text().notNull(),
      },
    )

    const db = o.db({ schema: { users } })

    const driver = new OrmMigratingBrowserDriver(
      db,
      ':memory:',
      undefined,
      false,
      true // useWorkerThread
    )

    await db._connectDriver(driver)

    // Insert a user
    const inserted = await db.users.insert({ id: 1, name: 'Alice' })
    expect(inserted).toMatchObject({ id: 1, name: 'Alice' })

    // Query the user
    const result = await db.users.select().execute()
    expect(result).toMatchObject([{ id: 1, name: 'Alice' }])
  })

  it('should handle transactions in worker thread', async () => {
    const users = o.table(
      'users',
      {
        id: o.integer().primaryKey(),
        name: o.text().notNull(),
      },
    )

    const db = o.db({ schema: { users } })

    const driver = new OrmMigratingBrowserDriver(
      db,
      ':memory:',
      undefined,
      false,
      true // useWorkerThread
    )

    await db._connectDriver(driver)

    // Test transaction
    await db.transaction(async (tx) => {
      await tx.users.insert({ id: 1, name: 'Bob' })
      await tx.users.insert({ id: 2, name: 'Carol' })
    })

    const result = await db.users.select().execute()
    expect(result).toHaveLength(2)
  })

  it('should work on main thread when useWorkerThread=false', async () => {
    const users = o.table(
      'users',
      {
        id: o.integer().primaryKey(),
        name: o.text().notNull(),
      },
    )

    const db = o.db({ schema: { users } })

    const driver = new OrmMigratingBrowserDriver(
      db,
      ':memory:',
      undefined,
      false,
      false // useWorkerThread = false (main thread)
    )

    await db._connectDriver(driver)

    // Insert a user
    const inserted = await db.users.insert({ id: 1, name: 'Alice' })
    expect(inserted).toMatchObject({ id: 1, name: 'Alice' })

    // Query the user
    const result = await db.users.select().execute()
    expect(result).toMatchObject([{ id: 1, name: 'Alice' }])
  })
})
