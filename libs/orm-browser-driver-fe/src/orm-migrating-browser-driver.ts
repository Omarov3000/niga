import type { Database } from '@sqlite.org/sqlite-wasm'
import type { OrmDriver, TxDriver, TableSnapshot } from '@w/orm'
import type { RawSql } from '@w/orm'
import type { Db } from '@w/orm'
import { o } from '@w/orm'
import { OrmBrowserDriver, makeBrowserSQLite } from './orm-browser-driver'
import { hashString128 } from './hash-string'
import { WorkerDriverAdapter } from './worker/worker-driver-adapter'
import { migrateDB, sortedJSONStringify } from './migrate-db'

export class OrmMigratingBrowserDriver implements OrmDriver {
  logging: boolean = false
  debugName: string = ''
  private connectingPromise?: Promise<void>
  private connectionError?: Error
  private _driver?: OrmDriver
  private workerAdapter?: WorkerDriverAdapter

  constructor(
    private orm: Db,
    private dbPath = ':memory:',
    private onInit?: (driver: OrmBrowserDriver) => void,
    logging = false,
    private useWorkerThread = false,
  ) {
    this.logging = logging
    this.connectingPromise = this.init()
  }

  private async driver(): Promise<OrmDriver> {
    if (this.connectingPromise) await this.connectingPromise
    if (this.connectionError) throw this.connectionError
    if (!this._driver) throw new Error('Driver not initialized')
    return this._driver
  }

  private async init(): Promise<void> {
    try {
      if (this.useWorkerThread) {
        // Create worker and use WorkerDriverAdapter
        const worker = new Worker(new URL('./worker/db-worker.ts', import.meta.url), { type: 'module' })
        this.workerAdapter = new WorkerDriverAdapter(worker)
        this.workerAdapter.logging = this.logging

        // Prepare snapshot and migration for worker
        const currentSnapshot = this.orm._prepareSnapshot().snapshot
        const currentSnapshotS = sortedJSONStringify(currentSnapshot)
        const currentSnapshotHash = hashString128(currentSnapshotS)
        const { migration } = this.orm._prepareSnapshot()

        // Initialize worker with migration
        await this.workerAdapter.sendMessage('init', {
          dbPath: this.dbPath,
          snapshot: currentSnapshot,
          migrationSql: migration.sql,
          snapshotHash: currentSnapshotHash,
          logging: this.logging,
        })

        this._driver = this.workerAdapter
        // Note: onInit callback expects OrmBrowserDriver, but we have WorkerDriverAdapter
        // This is a type limitation - the callback won't be called in worker mode
      } else {
        // Existing: create OrmBrowserDriver on main thread
        const db = makeBrowserSQLite(this.dbPath)
        const currentSnapshot = this.orm._prepareSnapshot().snapshot
        const currentSnapshotS = sortedJSONStringify(currentSnapshot)
        const currentSnapshotHash = hashString128(currentSnapshotS)
        const { migration } = this.orm._prepareSnapshot()
        migrateDB(db, currentSnapshot, migration.sql, currentSnapshotHash, this.logging)
        const browserDriver = new OrmBrowserDriver(db)
        browserDriver.logging = this.logging
        this._driver = browserDriver
        this.onInit?.(browserDriver)
      }
    } catch (e) {
      this.connectionError = e instanceof Error ? e : new Error(String(e))
    }
    this.connectingPromise = undefined
  }

  exec = async (sql: string) => {
    const driver = await this.driver()
    return driver.exec(sql)
  }

  run = async (q: RawSql) => {
    const driver = await this.driver()
    return driver.run(q)
  }

  batch = async (statements: RawSql[]) => {
    const driver = await this.driver()
    return driver.batch(statements)
  }

  beginTransaction = async (): Promise<TxDriver> => {
    const driver = await this.driver()
    return driver.beginTransaction()
  }
}
