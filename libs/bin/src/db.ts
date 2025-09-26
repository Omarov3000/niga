import type {
  BinDriver,
  QueryContext,
  TableMetadata,
  ColumnMetadata,
  SerializableTableMetadata,
  SerializableColumnMetadata,
  PreparedSnapshot,
  TableSnapshot,
  IndexDefinition
} from './types';
import { ColumnMutationNotSupportedError } from './types';
import { deepEqual } from 'fast-equals';
import type { ZodTypeAny } from 'zod';
import { sql } from './utils/sql';
import type { Table } from './table';
import { analyze } from './security/analyze';
import { camelCaseKeys } from './utils/casing';
import { normalizeQueryAnalysisToRuntime } from './security/normalize-analysis';

export interface DbConstructorOptions {
  schema: Record<string, Table<any, any>>;
  name?: string;
}

export class Db {
  private driver?: BinDriver;
  private currentUser?: any;
  readonly name: string;

  constructor(private options: DbConstructorOptions) {
    this.name = options.name ?? 'bin';
    // expose tables on the db instance and wire driver access for table methods
    Object.entries(this.options.schema).forEach(([name, table]) => {
      (this as any)[name] = table;
      // attach driver getter and user getter to table for methods like insert()
      (table as any).__db__ = {
        getDriver: () => {
          if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
          return this.driver;
        },
        getCurrentUser: () => this.currentUser,
        getSchema: () => this.options.schema,
      };
    });
  }

  async _connectDriver(driver: BinDriver): Promise<void> {
    this.driver = driver;
  }

  connectUser<TUser = any>(user: TUser): void {
    this.currentUser = user;
  }

  _connectUser<TUser = any>(user: TUser): void {
    this.connectUser(user);
  }

  query(strings: TemplateStringsArray, ...values: any[]) {
    const rawSql = sql(strings, ...values);
    const ensureDriver = () => {
      if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
      return this.driver;
    };

    const runSecurityChecks = async () => {
      const analysis = normalizeQueryAnalysisToRuntime(analyze(rawSql), this.options.schema);
      const accessedTables = Array.from(new Set(analysis.accessedTables.map((table) => table.name)));

      if (accessedTables.length === 0) {
        return;
      }

      const queryContext: QueryContext = {
        type: analysis.type,
        accessedTables,
        analysis
      };

      const user = this.currentUser;

      for (const tableName of accessedTables) {
        const table = this.options.schema[tableName] as Table<any, any> | undefined;
        if (!table) continue;
        await table.enforceSecurityRules(queryContext, user);
      }
    };

    return {
      execute: async <T extends ZodTypeAny>(zodSchema: T) => {
        const driver = ensureDriver();
        await runSecurityChecks();
        const rows = await Promise.resolve(driver.run(rawSql));
        const normalized = rows.map((row: Record<string, unknown>) => camelCaseKeys(row));
        return zodSchema.array().parse(normalized) as ReturnType<T['array']>['_output'];
      },
      executeAndTakeFirst: async <T extends ZodTypeAny>(zodSchema: T) => {
        const driver = ensureDriver();
        await runSecurityChecks();
        const rows = await Promise.resolve(driver.run(rawSql));
        if (!rows || rows.length === 0) throw new Error('No rows returned');
        const normalized = camelCaseKeys(rows[0]);
        return zodSchema.parse(normalized) as ReturnType<T['parse']>;
      },
    };
  }

  getSchemaDefinition(): string {
    const parts: string[] = [];
    Object.values(this.options.schema).forEach(({ __meta__ }) => {
      const tableSnapshot = tableMetaToSnapshot(__meta__);
      parts.push(serializeCreateTable(tableSnapshot));
      const indexStatements = createIndexStatements(tableSnapshot);
      if (indexStatements.length > 0) parts.push(indexStatements.join('\n'));
    });
    return parts.join('\n\n');
  }

  _prepareSnapshot(previous?: TableSnapshot[]): PreparedSnapshot {
    const currentSnapshot = buildSnapshotFromSchema(this.options.schema);
    const diffStatements = diffSnapshots(previous ?? [], currentSnapshot);
    const migrationSql = diffStatements.join('\n');
    const sanitizedSnapshot = currentSnapshot.map(stripRenameMetadata);

    return {
      snapshot: sanitizedSnapshot,
      migration: {
        name: generateMigrationName(),
        sql: migrationSql,
      },
      hasChanges: diffStatements.length > 0,
    };
  }

  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
    const txDriver = await this.driver.beginTransaction();

    const txTables: Record<string, any> = {};
    Object.entries(this.options.schema).forEach(([name, table]) => {
      const txTable = Object.create(table);
      Object.defineProperty(txTable, '__db__', {
        value: {
          getDriver: () => txDriver,
          getCurrentUser: () => this.currentUser,
          getSchema: () => this.options.schema,
        },
        enumerable: false,
        configurable: true,
        writable: false,
      });
      txTables[name] = txTable;
    });

    const txQuery = (_strings: TemplateStringsArray, _values: any[]) => {
      throw new Error('tx.query is not supported inside a transaction (reads are disabled)');
    };

    try {
      const result = await fn({ ...txTables, query: txQuery });
      await txDriver.commit();
      return result;
    } catch (e) {
      await txDriver.rollback();
      throw e;
    }
  }
}

function serializeCreateTable(table: SerializableTableMetadata): string {
  const columnSql = Object.values(table.columns).map((column) => serializeColumnDefinition(column, true));
  return `CREATE TABLE ${table.dbName} (\n${columnSql.join(',\n')}\n);`;
}

function createIndexStatements(table: SerializableTableMetadata): string[] {
  if (!table.indexes || table.indexes.length === 0) return [];
  return table.indexes.map((index) => createIndexSql(table.dbName, index));
}

function tableMetaToSnapshot(meta: TableMetadata): TableSnapshot {
  const columns = buildColumnsSnapshot(meta.columns);
  const indexes = buildIndexesSnapshot(meta.indexes, meta.dbName);

  return {
    name: meta.name,
    dbName: meta.dbName,
    columns,
    indexes,
    constrains: meta.constrains ? meta.constrains.map((c) => [...c]) : undefined,
    renamedFrom: meta.renamedFrom,
  };
}

function buildSnapshotFromSchema(schema: Record<string, Table<any, any>>): TableSnapshot[] {
  return Object.values(schema)
    .map((table) => tableMetaToSnapshot(table.__meta__))
    .sort((a, b) => a.dbName.localeCompare(b.dbName));
}

function buildColumnsSnapshot(columns: Record<string, ColumnMetadata | SerializableColumnMetadata>): Record<string, SerializableColumnMetadata> {
  const entries = Object.entries(columns)
    .map(([key, column]) => [key, cloneColumn(column)] as [string, SerializableColumnMetadata])
    .sort((a, b) => a[1].dbName.localeCompare(b[1].dbName));
  return Object.fromEntries(entries);
}

function cloneColumn(column: ColumnMetadata | SerializableColumnMetadata): SerializableColumnMetadata {
  const cloned: SerializableColumnMetadata = {
    name: column.name,
    dbName: column.dbName,
    type: column.type,
  };

  if (column.notNull) cloned.notNull = column.notNull;
  if (column.generatedAlwaysAs !== undefined) cloned.generatedAlwaysAs = column.generatedAlwaysAs;
  if (column.primaryKey) cloned.primaryKey = true;
  if (column.foreignKey) cloned.foreignKey = column.foreignKey;
  if (column.unique) cloned.unique = true;
  if (column.default !== undefined) cloned.default = column.default;
  if (column.appType) cloned.appType = column.appType;
  if (column.enumValues && column.enumValues.length > 0) cloned.enumValues = [...column.enumValues];
  if (column.renamedFrom) cloned.renamedFrom = column.renamedFrom;

  return cloned;
}

function buildIndexesSnapshot(indexes: IndexDefinition[] | undefined, tableDbName: string): IndexDefinition[] | undefined {
  if (!indexes || indexes.length === 0) return undefined;
  const normalized = indexes.map((idx) => ({
    name: idx.name ?? `${tableDbName}_${idx.columns.join('_')}_idx`,
    columns: [...idx.columns],
    unique: idx.unique ? true : undefined,
  }));
  normalized.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return normalized;
}

function diffSnapshots(previous: TableSnapshot[], current: TableSnapshot[]): string[] {
  const statements: string[] = [];
  const prevByDbName = new Map(previous.map((table) => [table.dbName, table] as const));
  const prevByName = new Map(previous.map((table) => [table.name, table] as const));
  const matchedPrev = new Set<string>();

  current.forEach((curr) => {
    let prev = prevByDbName.get(curr.dbName);

    if (!prev && curr.renamedFrom) {
      prev = prevByDbName.get(curr.renamedFrom) ?? prevByName.get(curr.renamedFrom);
      if (prev) statements.push(`ALTER TABLE ${prev.dbName} RENAME TO ${curr.dbName};`);
    }

    if (!prev) {
      statements.push(serializeCreateTable(curr));
      statements.push(...createIndexStatements(curr));
      return;
    }

    matchedPrev.add(prev.dbName);
    statements.push(...diffTableColumns(prev, curr));
    statements.push(...diffIndexes(prev, curr));
  });

  previous.forEach((prev) => {
    if (!matchedPrev.has(prev.dbName)) statements.push(`DROP TABLE ${prev.dbName};`);
  });

  return statements;
}

function diffTableColumns(previous: TableSnapshot, current: TableSnapshot): string[] {
  const statements: string[] = [];
  const prevByDbName = new Map(Object.values(previous.columns).map((col) => [col.dbName, col] as const));
  const prevByName = new Map(Object.values(previous.columns).map((col) => [col.name, col] as const));

  Object.values(current.columns).forEach((column) => {
    let prev = prevByDbName.get(column.dbName);

    if (!prev && column.renamedFrom) {
      prev = prevByDbName.get(column.renamedFrom) ?? prevByName.get(column.renamedFrom);
      if (prev) {
        statements.push(`ALTER TABLE ${current.dbName} RENAME COLUMN ${prev.dbName} TO ${column.dbName};`);
        prevByDbName.delete(prev.dbName);
      }
    }

    if (!prev) {
      statements.push(`ALTER TABLE ${current.dbName} ADD COLUMN ${serializeColumnDefinition(column)};`);
      return;
    }

    prevByDbName.delete(prev.dbName);
    if (!columnsEqual(prev, column)) {
      throw new ColumnMutationNotSupportedError(`Unsupported mutation for column ${column.dbName} on table ${current.dbName}`);
    }
  });

  prevByDbName.forEach((col) => {
    statements.push(`ALTER TABLE ${current.dbName} DROP COLUMN ${col.dbName};`);
  });

  return statements;
}

interface NormalizedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

function diffIndexes(previous: TableSnapshot, current: TableSnapshot): string[] {
  const statements: string[] = [];
  const prevIndexes = normalizeIndexes(previous);
  const currIndexes = normalizeIndexes(current);

  const prevByName = new Map(prevIndexes.map((idx) => [idx.name, idx] as const));
  const currByName = new Map(currIndexes.map((idx) => [idx.name, idx] as const));

  currIndexes.forEach((index) => {
    const prev = prevByName.get(index.name);
    if (!prev) {
      statements.push(createIndexSql(current.dbName, index));
      return;
    }

    if (!indexesEqual(prev, index)) {
      statements.push(`DROP INDEX ${prev.name};`);
      statements.push(createIndexSql(current.dbName, index));
    }
  });

  prevIndexes.forEach((index) => {
    if (!currByName.has(index.name)) statements.push(`DROP INDEX ${index.name};`);
  });

  return statements;
}

function normalizeIndexes(table: TableSnapshot): NormalizedIndex[] {
  if (!table.indexes || table.indexes.length === 0) return [];
  return table.indexes.map((idx) => ({
    name: idx.name ?? `${table.dbName}_${idx.columns.join('_')}_idx`,
    columns: [...idx.columns],
    unique: idx.unique === true,
  }));
}

function indexesEqual(a: NormalizedIndex, b: NormalizedIndex): boolean {
  return deepEqual(a, b);
}

function serializeColumnDefinition(column: SerializableColumnMetadata, indent = false): string {
  const parts: string[] = [column.dbName, column.type.toUpperCase()];

  if (column.generatedAlwaysAs) {
    parts.push(`GENERATED ALWAYS AS (${column.generatedAlwaysAs}) VIRTUAL`);
  } else {
    if (column.notNull) parts.push('NOT NULL');
    if (column.primaryKey) parts.push('PRIMARY KEY');
    if (column.unique) parts.push('UNIQUE');
    if (column.default !== undefined) parts.push(`DEFAULT ${formatDefaultValue(column.default)}`);
    if (column.foreignKey) {
      const [tableName, columnName] = column.foreignKey.split('.');
      parts.push(`REFERENCES ${tableName}(${columnName})`);
    }
  }

  const definition = parts.join(' ');
  return indent ? `  ${definition}` : definition;
}

function formatDefaultValue(value: SerializableColumnMetadata['default']): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

function columnsEqual(a: SerializableColumnMetadata, b: SerializableColumnMetadata): boolean {
  return deepEqual(sanitizeColumnForComparison(a), sanitizeColumnForComparison(b));
}

function sanitizeColumnForComparison(column: SerializableColumnMetadata): SerializableColumnMetadata {
  const copy = structuredClone(column);
  delete (copy as any).dbName;
  delete (copy as any).name;
  delete copy.renamedFrom;
  return copy;
}

function createIndexSql(tableDbName: string, index: IndexDefinition | NormalizedIndex): string {
  const indexName = index.name ?? `${tableDbName}_${index.columns.join('_')}_idx`;
  const unique = index.unique ? 'UNIQUE ' : '';
  return `CREATE ${unique}INDEX ${indexName} ON ${tableDbName}(${index.columns.join(', ')});`;
}

function generateMigrationName(date: Date = new Date()): string {
  const iso = date.toISOString();
  const [base] = iso.split('.');
  return `${base.replaceAll('-', '_').replaceAll(':', '_')}Z.sql`;
}

function stripRenameMetadata(snapshot: TableSnapshot): TableSnapshot {
  const sanitized = structuredClone(snapshot);
  delete sanitized.renamedFrom;
  Object.values(sanitized.columns).forEach((column) => {
    delete column.renamedFrom;
  });
  return sanitized;
}
