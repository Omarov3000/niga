import { Table } from '../schema/table'
import { Column } from '../schema/column'
import { toSnakeCase } from '../utils/casing'

function text() {
  return new Column<'text', string, 'optional'>({ kind: 'public', name: 'text', type: 'text' })
}

function integer() {
  return new Column<'integer', number, 'optional'>({ kind: 'public', name: 'integer', type: 'integer' })
}

function makeTable<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols
): Table<Name, TCols> & TCols {
  Object.entries(columns).forEach(([colName, col]) => {
    (col as any).__meta__.name = colName as any
    (col as any).__meta__.dbName = toSnakeCase(colName)
  })

  const instance = new Table<Name, TCols>({
    name,
    columns: columns as any,
  }) as any

  Object.entries(columns).forEach(([colName, col]) => {
    instance[colName] = col
  })

  return instance as Table<Name, TCols> & TCols
}

// _db_mutations_queue table
const _dbMutationsQueueColumns = {
  id: text().primaryKey(),
  value: text().notNull(),
  serverTimestampMs: integer().notNull().default(0),
}

export const _dbMutationsQueue = makeTable('_db_mutations_queue', _dbMutationsQueueColumns)

// _db_mutations_queue_dead table
const _dbMutationsQueueDeadColumns = {
  id: text().primaryKey(),
  value: text().notNull(),
  reason: text().notNull(),
}

export const _dbMutationsQueueDead = makeTable('_db_mutations_queue_dead', _dbMutationsQueueDeadColumns)

// _sync_pull_progress table
const _syncPullProgressColumns = {
  tableName: text().primaryKey(),
  state: text().notNull(), // number (offset) or 'all' (fully synced)
}

export const _syncPullProgress = makeTable('_sync_pull_progress', _syncPullProgressColumns)

export const internalTables = {
  _db_mutations_queue: _dbMutationsQueue,
  _db_mutations_queue_dead: _dbMutationsQueueDead,
  _sync_pull_progress: _syncPullProgress,
}
