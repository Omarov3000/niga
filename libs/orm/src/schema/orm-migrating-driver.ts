import type { OrmDriver, TxDriver } from './types'
import type { RawSql } from '../utils/sql'
import type { Db } from './db'
import { migrateDB, sortedJSONStringify } from './migrate-db'
import { hashString128 } from '../utils/hash-string'

export class OrmMigratingDriver implements OrmDriver {
  logging: boolean = false
  debugName: string = ''
  private connectingPromise?: Promise<void>
  private connectionError?: Error

  constructor(
    private innerDriver: OrmDriver,
    private db: Db,
    logging = false,
    private mode: 'full' | 'minimal' = 'full'
  ) {
    this.logging = logging
    this.innerDriver.logging = logging
    this.debugName = innerDriver.debugName
    this.connectingPromise = this.init()
  }

  private async ensureInitialized(): Promise<void> {
    if (this.connectingPromise) await this.connectingPromise
    if (this.connectionError) throw this.connectionError
  }

  private async init(): Promise<void> {
    try {
      const currentSnapshot = this.db._prepareSnapshot().snapshot
      const currentSnapshotS = sortedJSONStringify(currentSnapshot)
      const currentSnapshotHash = hashString128(currentSnapshotS)

      // Use getSchemaDefinition with mode instead of migration SQL from _prepareSnapshot
      // This allows us to control FK constraints (minimal mode = no FK constraints for offline support)
      const migrationSql = this.db.getSchemaDefinition(this.mode)

      await migrateDB(
        this.innerDriver,
        currentSnapshot,
        migrationSql,
        currentSnapshotHash,
        this.logging
      )
    } catch (e) {
      this.connectionError = e instanceof Error ? e : new Error(String(e))
    }
    this.connectingPromise = undefined
  }

  async exec(sql: string): Promise<void> {
    await this.ensureInitialized()
    return this.innerDriver.exec(sql)
  }

  async run(q: RawSql): Promise<any> {
    await this.ensureInitialized()
    return this.innerDriver.run(q)
  }

  async batch(statements: RawSql[]): Promise<any[]> {
    await this.ensureInitialized()
    return this.innerDriver.batch(statements)
  }

  async beginTransaction(): Promise<TxDriver> {
    await this.ensureInitialized()
    return this.innerDriver.beginTransaction()
  }
}
