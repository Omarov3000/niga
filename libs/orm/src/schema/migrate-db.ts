import type { OrmDriver, TableSnapshot } from './types'

export function sortedJSONStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

export async function migrateDB(
  driver: OrmDriver,
  currentSnapshot: TableSnapshot[],
  migrationSql: string,
  currentSnapshotHash: string,
  logging = false
): Promise<void> {
  const currentSnapshotS = sortedJSONStringify(currentSnapshot)

  let needsMigration = false
  let hasMigrationsTable = false

  const tableCheckResult = await driver.run({
    query: `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    params: [],
  })

  if (tableCheckResult.length === 0) {
    needsMigration = true
  } else {
    hasMigrationsTable = true
    const hashCheckResult = await driver.run({
      query: 'SELECT 1 FROM _migrations WHERE snapshot_hash = ?',
      params: [currentSnapshotHash],
    })
    if (hashCheckResult.length === 0) needsMigration = true
  }

  if (!needsMigration) return

  let prevSnapshot: TableSnapshot[] | undefined
  if (hasMigrationsTable) {
    const snapshotResult = await driver.run({
      query: 'SELECT snapshot FROM _migrations',
      params: [],
    })

    if (snapshotResult.length > 1) throw new Error('Multiple migrations not supported (impossible)')
    if (snapshotResult.length > 0) {
      prevSnapshot = JSON.parse(snapshotResult[0].snapshot as string) as TableSnapshot[]
    }
  }

  const migrationTableCreate = `
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL
    );

    ${migrationSql}

    INSERT OR REPLACE INTO _migrations (id, snapshot, snapshot_hash) VALUES ('snapshot', '${currentSnapshotS}', '${currentSnapshotHash}');`

  if (logging) {
    console.info('[migrateDB] migrationTableCreate')
    console.info(migrationTableCreate)
  }

  // Split multi-statement SQL into individual statements for batch execution
  const statements = migrationTableCreate
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => ({ query: s, params: [] }))

  await driver.batch(statements)

  if (logging) console.info('[migrateDB] succeeded')
}
