import { expect, it } from 'vitest';
import { makeBrowserSQLite, OrmBrowserDriver } from './orm-browser-driver';
import { runSharedOrmDriverTests } from '@w/orm/run-shared-orm-driver-tests';
import { o, AlwaysOnlineDetector, TestRemoteDb, internalSyncTables } from '@w/orm';

const {driver, clearRef} = runSharedOrmDriverTests(() => new OrmBrowserDriver(makeBrowserSQLite()), { skipTableCleanup: true })

it('syncs mutations from client1 to client2', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text(),
    email: o.text(),
  })

  // Create server
  const serverDriver = new OrmBrowserDriver(makeBrowserSQLite())
  const serverDb = await o.testDb(
    {
      schema: { users, ...internalSyncTables },
      origin: 'server',
      debugName: 'server',
    },
    serverDriver
  )
  const remoteDb = new TestRemoteDb(serverDb, serverDriver, { users })

  // Create client1
  const client1Driver = new OrmBrowserDriver(makeBrowserSQLite())
  const client1 = await o.syncedDb({
    schema: { users },
    driver: client1Driver,
    remoteDb,
    skipPull: true,
    onlineDetector: new AlwaysOnlineDetector(),
    debugName: 'client1',
  })

  // Client1 inserts a user
  await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })

  // Create client2 - should receive the mutation from client1
  const client2Driver = new OrmBrowserDriver(makeBrowserSQLite())
  const client2 = await o.syncedDb({
    schema: { users },
    driver: client2Driver,
    remoteDb,
    skipPull: true,
    onlineDetector: new AlwaysOnlineDetector(),
    debugName: 'client2',
  })

  // Verify client2 received the mutation
  const result = await client2.users.select().execute()
  expect(result).toMatchObject([
    { name: 'Alice', email: 'alice@example.com' }
  ])
})
