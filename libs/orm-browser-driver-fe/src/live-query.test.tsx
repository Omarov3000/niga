import React, { Suspense } from 'react'
import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useSuspenseQuery, useMutation, QueryClient } from '@w/query-fe'
import { render } from './_test-helpers'
import { o } from '@w/orm'
import { OrmBrowserDriver, makeBrowserSQLite } from './orm-browser-driver'

const queryClient = new QueryClient()

beforeEach(() => {
  queryClient.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('should update query when mutations are applied (insert, update, delete)', async () => {
  const usersTable = o.table('users', {
    id: o.id(),
    name: o.text().notNull(),
    age: o.integer(),
  })
  const db = o.db({ schema: { users: usersTable } })
  const sqlite = makeBrowserSQLite()
  await db._connectDriver(new OrmBrowserDriver(sqlite))
  sqlite.exec(db.getSchemaDefinition())

  function TestComponent() {
    const query = useSuspenseQuery(db.users.select().options(), queryClient)
    const insertManyMutation = useMutation(db.users.insertManyOptions(), queryClient)
    const updateMutation = useMutation(db.users.updateOptions(), queryClient)
    const deleteMutation = useMutation(db.users.deleteOptions(), queryClient)

    return (
      <div>
        <div data-testid="count">{query.data.length}</div>
        <div data-testid="users">{JSON.stringify(query.data)}</div>
        <button
          data-testid="insert"
          onClick={() => insertManyMutation.mutate([{ name: 'Alice', age: 25 }, { name: 'Bob', age: 30 }])}
        >
          Insert
        </button>
        <button
          data-testid="update"
          onClick={() => updateMutation.mutate({ data: { age: 26 }, where: db.users.name.eq('Alice') })}
        >
          Update
        </button>
        <button
          data-testid="delete"
          onClick={() => deleteMutation.mutate({ where: db.users.name.eq('Bob') })}
        >
          Delete
        </button>
      </div>
    )
  }

  const { see, click } = render(
    <Suspense fallback={<div data-testid="loading">Loading...</div>}>
      <TestComponent />
    </Suspense>
  )

  await see('loading', 'Loading...')
  await see('count', '0')

  await click('insert')
  await vi.waitFor(() => see('count', '2'))

  await click('update')
  await vi.waitFor(() => see('count', '2'))

  await click('delete')
  await vi.waitFor(() => see('count', '1'))
})

it('should update db.query with CTE when insert mutation is applied', async () => {
  const usersTable = o.table('users', {
    id: o.id(),
    name: o.text().notNull(),
  })
  const db = o.db({ schema: { users: usersTable } })
  const sqlite = makeBrowserSQLite()
  await db._connectDriver(new OrmBrowserDriver(sqlite))
  sqlite.exec(db.getSchemaDefinition())

  const userCountSchema = o.z.object({
    count: o.z.integer(),
  })

  function TestComponent() {
    const query = useSuspenseQuery(
      db.query`
        WITH user_stats AS (
          SELECT COUNT(*) as count FROM users
        )
        SELECT count FROM user_stats
      `.options(userCountSchema, { depends: ['users'] }),
      queryClient
    )
    const insertMutation = useMutation(db.users.insertOptions(), queryClient)

    return (
      <div>
        <div data-testid="count">{query.data[0]?.count ?? 0}</div>
        <button data-testid="insert" onClick={() => insertMutation.mutate({ name: 'Charlie' })}>
          Insert
        </button>
      </div>
    )
  }

  const { see, click } = render(
    <Suspense fallback={<div data-testid="loading">Loading...</div>}>
      <TestComponent />
    </Suspense>
  )

  await see('loading', 'Loading...')
  await see('count', '0')

  await click('insert')
  await vi.waitFor(() => see('count', '1'))
})
