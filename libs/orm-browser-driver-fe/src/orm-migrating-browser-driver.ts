import type { Database } from '@sqlite.org/sqlite-wasm'
import type { OrmDriver, TxDriver, RawSql, Db } from '@w/orm'
import { OrmMigratingDriver, sortedJSONStringify, hashString128 } from '@w/orm'
import { OrmBrowserDriver, makeBrowserSQLite } from './orm-browser-driver'
import { WorkerDriverAdapter } from './worker/worker-driver-adapter'

export class OrmMigratingBrowserDriver extends OrmMigratingDriver {
  constructor(
    orm: Db,
    dbPath = ':memory:',
    onInit?: (driver: OrmBrowserDriver) => void,
    logging = false,
  ) {
    const db = makeBrowserSQLite(dbPath)
    const browserDriver = new OrmBrowserDriver(db)
    browserDriver.logging = logging

    super(browserDriver, orm, logging)

    onInit?.(browserDriver)
  }
}
