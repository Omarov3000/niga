import type { Database } from '@sqlite.org/sqlite-wasm'
import type { TableSnapshot } from '@w/orm'

export function sortedJSONStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

export function migrateDB(
  db: Database,
  currentSnapshot: TableSnapshot[],
  migrationSql: string,
  currentSnapshotHash: string,
  logging = false
) {
  const currentSnapshotS = sortedJSONStringify(currentSnapshot)

  let needsMigration = false
  let hasMigrationsTable = false

  const checkTableStmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`)
  const tableExists = checkTableStmt.step()
  checkTableStmt.finalize()

  if (!tableExists) {
    needsMigration = true
  } else {
    hasMigrationsTable = true
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

  db.transaction(() => {
    db.exec(migrationTableCreate)
  })

  if (logging) console.info('[migrateDB] succeeded')
}
