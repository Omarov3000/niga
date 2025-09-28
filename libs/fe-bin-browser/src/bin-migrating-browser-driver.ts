import type { Database } from '@sqlite.org/sqlite-wasm'
import type { BinDriver, TxDriver, TableSnapshot } from '@w/bin/src/types'
import type { RawSql } from '@w/bin/src/utils/sql'
import type { Db } from '@w/bin/src/db'
import { BinBrowserDriver, makeBrowserSQLite } from './bin-browser-driver'
import { hashString128 } from './hash-string'

function sortedJSONStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

function migrateDB(
  db: Database,
  bin: Db,
  logging = false,
) {
  const currentSnapshot = bin._prepareSnapshot().snapshot
  const currentSnapshotS = sortedJSONStringify(currentSnapshot)
  const currentSnapshotHash = hashString128(currentSnapshotS)

  let needsMigration = false
  let hasMigrationsTable = false

  // Check if migrations table exists using prepare/step pattern
  const checkTableStmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`)
  const tableExists = checkTableStmt.step()
  checkTableStmt.finalize()

  if (!tableExists) {
    needsMigration = true
  } else {
    hasMigrationsTable = true
    // Check if current snapshot hash exists
    const checkHashStmt = db.prepare('SELECT 1 FROM _migrations WHERE snapshot_hash = ?')
    checkHashStmt.bind([currentSnapshotHash])
    const hashExists = checkHashStmt.step()
    checkHashStmt.finalize()
    if (!hashExists) needsMigration = true
  }

  if (!needsMigration) return

  let prevSnapshot: TableSnapshot[] | undefined
  if (hasMigrationsTable) {
    const getSnapshotStmt = db.prepare('SELECT snapshot FROM _migrations')
    const snapshots = []
    while (getSnapshotStmt.step()) {
      snapshots.push(getSnapshotStmt.get({}))
    }
    getSnapshotStmt.finalize()

    if (snapshots.length > 1) throw new Error('Multiple migrations not supported (impossible)')
    if (snapshots.length > 0) {
      prevSnapshot = JSON.parse(snapshots[0].snapshot as string) as TableSnapshot[]
    }
  }

  const { migration } = bin._prepareSnapshot(prevSnapshot)

  const migrationTableCreate = `
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL
    );

    ${migration.sql}

    INSERT OR REPLACE INTO _migrations (id, snapshot, snapshot_hash) VALUES ('snapshot', '${currentSnapshotS}', '${currentSnapshotHash}');`

  if (logging) {
    console.info('migrationTableCreate')
    console.info(migrationTableCreate)
  }

  db.transaction(() => {
    db.exec(migrationTableCreate)
  })

  if (logging) console.info('migrateDb succeeded')
}

export class BinMigratingBrowserDriver implements BinDriver {
  logging: boolean = false
  private connectingPromise?: Promise<void>
  private connectionError?: Error
  private _driver?: BinBrowserDriver

  constructor(
    private bin: Db,
    private dbPath = ':memory:',
    private onInit?: (driver: BinBrowserDriver) => void,
    logging = false,
  ) {
    this.logging = logging
    this.connectingPromise = this.init()
  }

  private async driver(): Promise<BinBrowserDriver> {
    if (this.connectingPromise) await this.connectingPromise
    if (this.connectionError) throw this.connectionError
    if (!this._driver) throw new Error('Driver not initialized')
    return this._driver
  }

  private async init(): Promise<void> {
    try {
      const db = makeBrowserSQLite(this.dbPath)
      migrateDB(db, this.bin, this.logging)
      this._driver = new BinBrowserDriver(db)
      this._driver.logging = this.logging
      this.onInit?.(this._driver)
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
