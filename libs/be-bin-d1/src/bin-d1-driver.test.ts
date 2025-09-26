import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { runSharedBinDriverTests } from '@w/bin/src/run-shared-bin-driver-tests'
import { BinD1Driver } from './bin-d1-driver'
import { b } from '@w/bin/src/builder'

// const driverRef = { driver: new BinD1Driver(env.testD1) }
// const clearRef: { current?: Array<() => Promise<void>> } = { current: [] };

// it('works', async () => {
//   const users = b.table('users', {
//       id: b.id(),
//       name: b.text(),
//       age: b.integer().default(0),
//       email: b.text(),
//     });

//     const db = await b.testDb({ schema: { users } }, driverRef.driver, clearRef);

//     await users.insert({
//       id: 'test-123',
//       name: 'John Doe',
//       email: 'john@example.com',
//       age: 20,
//     });

//     const rows = await driverRef.driver.run({ query: 'SELECT id, name, email, age FROM users WHERE id = ?', params: ['test-123'] });

//     expect(rows).toMatchObject([
//       { id: 'test-123', name: 'John Doe', email: 'john@example.com', age: 20 },
//     ]);
// })

const {driverRef, clearRef} = runSharedBinDriverTests(() => new BinD1Driver(env.testD1))

describe('batch', () => {
  it('rolls back earlier statements when a later statement fails', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    })

    await b.testDb({ schema: { users } }, driverRef.driver, clearRef)

    await expect(
      driverRef.driver.batch([
        { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: ['u1', 'Alice'] },
        { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: ['u1', 'Duplicate'] },
      ])
    ).rejects.toThrow()

    const rows = await driverRef.driver.run({ query: 'SELECT id, name FROM users WHERE id = ?', params: ['u1'] })
    expect(rows).toMatchObject([])
  })
})
