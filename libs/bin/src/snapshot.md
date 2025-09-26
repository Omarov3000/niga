# Bin Snapshot & Migration Specification

## Scope
Define the contracts and behaviour required to generate, persist, and verify database schema snapshots and SQL migrations for projects built on typed "bins". This spec omits runtime ORM details and focuses strictly on the pieces needed to diff schema metadata and author deterministic migration files.

## Core Concepts
- **Bin Snapshot**: JSON representation of the current database schema, used as the source of truth when diffing future changes.
- **Prepared Snapshot**: Result of comparing the live schema to the previous snapshot; contains new SQL plus the next snapshot payload.
- **Migrator**: Filesystem-aware utility that drives snapshot comparison and materialises migration artefacts.

## Required Interfaces

### Schema Provider
Bins must expose a minimal snapshot-preparation surface:

```ts
export type TableSnapshot = SerializableTableMetadata

export interface PreparedSnapshot {
  snapshot: TableSnapshot[]
  migration: {
    name: string
    sql: string
  }
  hasChanges: boolean
}

export interface Db {
  name: string
  _connectDriver(driver: BinDriver): void
  ...
  _prepareSnapshot(previous?: TableSnapshot[]): PreparedSnapshot
}
```

### Migrator

```ts
// bin/src/migrate.ts

// DOCS
// create _migrate.ts script alongside your package.json with
// import { db } from './src/BIN_NAME.bin'
// import { migrate } from '@w/bin/migrate'

// migrate(db)
// add to package.json scripts:
// "migrate": "pnpm exec tsx bin/src/migrate.ts"

// "migrate:generate": "vite-node _migrate.ts",
// "migrate": "wrangler d1 migrations apply BIN_NAME",
// "migrate:local": "wrangler d1 migrations apply BIN_NAME --local",

export async function migrate(b: Db) {
  const snapshotName = join(process.cwd(), 'src', `${b.name}.bin.json`)
  const oldSnapshot = readFile(snapshotName).then(JSON.parse)
    .catch(() => undefined)
  const snapshot = b._prepareSnapshot(oldSnapshot)
  if (snapshot.hasChanges) {
    await writeFile(join(process.cwd(), 'migrations', snapshot.migration.name), snapshot.migration.sql)
    await writeFile(snapshotName, JSON.stringify(snapshot.snapshot, null, 2))
    console.info('Migration has been prepared.')
  } else console.info('No changes detected.')
}
```

Migration filenames must be unique and sortable; example, `2024_04_12T19_11_03Z.sql`).

## Test Matrix
Implement tests in bin-node-driver.test.ts. Each test constructs a temporary bin, captures an initial snapshot, mutates the schema, and asserts the generated SQL or errors. SQL should be executed against an in-memory driver when possible to validate syntax.

| ID  | Scenario                        | Expected Outcome |
|-----|---------------------------------|------------------|
| T01 | No schema change                | `hasChanges=false`, empty SQL |
| T02 | Add table                       | `CREATE TABLE`, indexes serialized |
| T03 | Remove table                    | `DROP TABLE <name>;` |
| T04 | Rename table                    | `ALTER TABLE <old> RENAME TO <new>;` |
| T05 | Add column                      | `ALTER TABLE <table> ADD COLUMN ...;` |
| T06 | Remove column                   | `ALTER TABLE <table> DROP COLUMN ...;` |
| T07 | Rename column                   | `ALTER TABLE <table> RENAME COLUMN ...;` |
| T08 | Add index                       | `CREATE INDEX <derived> ON <table>(...);` |
| T09 | Remove index                    | `DROP INDEX <derived>;` |
| T10 | Generated column metadata       | Column DDL includes `GENERATED ALWAYS AS ... VIRTUAL` |
| T11 | Unsupported column mutation     | Throws `ColumnMutationNotSupportedError` |
| T12 | Snapshot persistence            | Written JSON deep-equals `snapshot` payload |
| T14 | Migrator idempotence            | Running migrator twice without changes produces no additional files |
