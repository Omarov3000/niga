import type {
  OrmDriver,
  QueryContext,
  TableMetadata,
  ColumnMetadata,
  SerializableTableMetadata,
  SerializableColumnMetadata,
  PreparedSnapshot,
  TableSnapshot,
  IndexDefinition,
  ConstraintDefinition,
  DerivationContext
} from './types';
import { ColumnMutationNotSupportedError } from './types';
import { deepEqual } from 'fast-equals';
import type { Schema } from '@w/schema';
import { s } from '@w/schema';
import { sql } from '../utils/sql';
import type { Table } from './table';
import { camelCaseKeys } from '../utils/casing';
import { normalizeQueryAnalysisToRuntime } from '../true-sql/normalize-analysis';
import { analyze } from '../true-sql/analyze';
import { rawQueryToAst } from '../true-sql/raw-query-to-ast';
import { extractTables } from '../true-sql/extract-tables';
import type { UseQueryOptions } from '../../../query-fe/src/use-query-types';
import { DerivedTable } from '../sync/derived-table';

export interface DbConstructorOptions {
  schema: Record<string, Table<any, any>>;
  name?: string;
  debugName?: string;
  origin?: 'client' | 'server';
  isProd?: () => boolean;
  logging?: boolean;
}

export class Db {
  private driver?: OrmDriver;
  protected currentUser?: any;
  readonly name: string;
  readonly debugName: string;
  readonly origin?: 'client' | 'server';
  readonly logging: boolean;
  private revalidationQueue: Array<{ sourceTableName?: string; context: DerivationContext }> = [];
  private isProcessingQueue: boolean = false;
  private currentRevalidationPromise?: Promise<void>;

  constructor(protected options: DbConstructorOptions) {
    this.name = options.name ?? 'orm';
    this.debugName = options.debugName ?? this.name;
    this.origin = options.origin;
    this.logging = options.logging ?? false;

    // Clone each table to avoid shared state between db instances
    Object.entries(this.options.schema).forEach(([name, table]) => {
      const clonedTable = table.clone();

      // Assign __db__ context to the cloned table
      (clonedTable as any).__db__ = {
        getDriver: () => {
          if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
          return this.driver;
        },
        getCurrentUser: () => this.currentUser,
        getSchema: () => this.options.schema,
        isProd: () => this.options.isProd ? this.options.isProd() : false,
        revalidateDerivedTables: this.revalidateDerivedTables.bind(this),
      };

      (this as any)[name] = clonedTable;
    });
  }

  async _connectDriver(driver: OrmDriver): Promise<void> {
    this.driver = driver;
    driver.logging = this.logging;
    driver.debugName = this.debugName;
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

    const executeQuery = async <T extends Schema>(schema: T) => {
      const driver = ensureDriver();
      await runSecurityChecks();
      const rows = await Promise.resolve(driver.run(rawSql));
      const normalized = rows.map((row: Record<string, unknown>) => camelCaseKeys(row));
      const arraySchema = s.array(schema);
      return (arraySchema as any).parse(normalized) as s.infer<typeof arraySchema>;
    };

    return {
      execute: executeQuery,
      executeAndTakeFirst: async <T extends Schema>(schema: T) => {
        const driver = ensureDriver();
        await runSecurityChecks();
        const rows = await Promise.resolve(driver.run(rawSql));
        if (!rows || rows.length === 0) throw new Error('No rows returned');
        const normalized = camelCaseKeys(rows[0]);
        return (schema as any).parse(normalized) as s.infer<T>;
      },
      toAst: () => {
        return rawQueryToAst(rawSql);
      },
      options: <T extends Schema>(schema: T, overrides?: Partial<Omit<UseQueryOptions<s.infer<ReturnType<typeof s.array<T>>>>, 'queryKey' | 'queryFn'>>): UseQueryOptions<s.infer<ReturnType<typeof s.array<T>>>> => {
        const depends = extractTables(rawSql);
        return {
          queryKey: [rawSql.query, ...rawSql.params],
          queryFn: () => executeQuery(schema),
          depends,
          ...overrides,
        };
      },
    };
  }

  getSchemaDefinition(mode: 'full' | 'minimal' = 'full'): string {
    const parts: string[] = [];
    Object.values(this.options.schema).forEach(({ __meta__ }) => {
      // Skip derived tables on server - they're client-only
      // But include them on client so they get created in local DB
      const isDerived = __meta__.derivedFrom && __meta__.derivedFrom.length > 0
      if (isDerived && this.origin !== 'client') return

      const tableSnapshot = tableMetaToSnapshot(__meta__);
      parts.push(serializeCreateTable(tableSnapshot, mode));
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

  async _clear(): Promise<void> {
    if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
    const driver = this.driver;
    // Filter out derived tables when origin !== 'client'
    const tables = Object.values(this.options.schema)
      .filter(table => {
        const isDerived = table.__meta__.derivedFrom && table.__meta__.derivedFrom.length > 0
        return !(isDerived && this.origin !== 'client')
      })
      .map((table) => table.__meta__.dbName)
      .filter((name, index, all) => all.indexOf(name) === index);

    if (tables.length === 0) return;

    await driver.exec('PRAGMA foreign_keys = OFF');
    try {
      const deleteStatements = tables
        .map((name) => `DELETE FROM ${quoteIdentifier(name)};`)
        .join(' ');
      await driver.exec(deleteStatements);
    } finally {
      await driver.exec('PRAGMA foreign_keys = ON');
    }
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
          isProd: () => this.options.isProd ? this.options.isProd() : false,
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

  async batch<T>(fn: (batch: any) => Promise<T>): Promise<T> {
    if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');

    const statements: Array<{ query: string; params: any[] }> = [];
    const batchDriver: OrmDriver = {
      ...this.driver,
      run: async (sql) => {
        statements.push(sql);
        return [];
      },
      exec: async (sql) => {
        statements.push({ query: sql, params: [] });
      },
      beginTransaction: async () => {
        throw new Error('Nested transactions not supported in batch');
      },
    };

    const batchTables: Record<string, any> = {};
    Object.entries(this.options.schema).forEach(([name, table]) => {
      const batchTable = Object.create(table);
      Object.defineProperty(batchTable, '__db__', {
        value: {
          getDriver: () => batchDriver,
          getCurrentUser: () => this.currentUser,
          getSchema: () => this.options.schema,
          isProd: () => this.options.isProd ? this.options.isProd() : false,
        },
        enumerable: false,
        configurable: true,
        writable: false,
      });
      batchTables[name] = batchTable;
    });

    const batchQuery = (_strings: TemplateStringsArray, _values: any[]) => {
      throw new Error('batch.query is not supported inside a batch (reads are disabled)');
    };

    const result = await fn({ ...batchTables, query: batchQuery });
    await this.driver.batch(statements);
    return result;
  }

  async revalidateDerivedTables(
    sourceTableName?: string,
    context: DerivationContext = { type: 'full' }
  ): Promise<void> {
    // Add to queue
    this.revalidationQueue.push({ sourceTableName, context });

    // If already processing, the queued item will be picked up
    if (this.isProcessingQueue) return this.currentRevalidationPromise!;

    // Start processing queue
    this.isProcessingQueue = true;
    this.currentRevalidationPromise = this.processRevalidationQueue();
    return this.currentRevalidationPromise;
  }

  private async processRevalidationQueue(): Promise<void> {
    try {
      while (this.revalidationQueue.length > 0) {
        // Get all queued items and clear queue
        const batch = this.revalidationQueue.splice(0);

        // Group by source table and context type
        const revalidationMap = new Map<string, { full: boolean; incremental: DerivationContext[] }>();

        for (const item of batch) {
          const key = item.sourceTableName || '__all__';
          if (!revalidationMap.has(key)) {
            revalidationMap.set(key, { full: false, incremental: [] });
          }
          const entry = revalidationMap.get(key)!;

          if (item.context.type === 'full' || !item.sourceTableName) {
            entry.full = true;
          } else {
            entry.incremental.push(item.context);
          }
        }

        // Get derived tables from the db instance (not options.schema) because they've been cloned
        const derivedTables = Object.keys(this.options.schema)
          .map(name => (this as any)[name] as Table<any, any>)
          .filter(table => table && table.__meta__.derivedFrom && table.__meta__.derivedFrom.length > 0) as DerivedTable<any, any>[];

        // Process each source table
        for (const [sourceTableName, { full, incremental }] of revalidationMap) {
          // Filter by source table
          const tablesToRevalidate = sourceTableName === '__all__'
            ? derivedTables
            : derivedTables.filter(table => {
                const dependencies = table.__meta__.derivedFrom ?? [];
                return dependencies.includes(sourceTableName);
              });

          if (tablesToRevalidate.length === 0) continue;

          // Topologically sort to handle dependencies
          const sorted = topologicalSort(tablesToRevalidate);

          // Choose context: full if any full revalidation, otherwise use first incremental
          const revalidationContext: DerivationContext = full
            ? { type: 'full' }
            : incremental[0] || { type: 'full' };

          // Revalidate in dependency order
          for (const derivedTable of sorted) {
            try {
              await this.transaction(async () => {
                await derivedTable._revalidate(revalidationContext);
              });
            } catch (error) {
              console.error(`Failed to revalidate derived table ${derivedTable.__meta__.name}:`, error);
              // Continue with other tables
            }
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }
}

function topologicalSort(derivedTables: DerivedTable<any, any>[]): DerivedTable<any, any>[] {
  const sorted: DerivedTable<any, any>[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const tableMap = new Map(derivedTables.map(t => [t.__meta__.name, t]))

  function visit(table: DerivedTable<any, any>) {
    if (visited.has(table.__meta__.name)) return
    if (visiting.has(table.__meta__.name)) {
      throw new Error(`Circular dependency detected involving ${table.__meta__.name}`)
    }

    visiting.add(table.__meta__.name)

    const deps = table.__meta__.derivedFrom ?? []
    for (const depName of deps) {
      const depTable = tableMap.get(depName)
      if (depTable) visit(depTable)
    }

    visiting.delete(table.__meta__.name)
    visited.add(table.__meta__.name)
    sorted.push(table)
  }

  for (const table of derivedTables) {
    visit(table)
  }

  return sorted
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function serializeCreateTable(table: SerializableTableMetadata, mode: 'full' | 'minimal' = 'full'): string {
  const columnSql = Object.values(table.columns).map((column) => serializeColumnDefinition(column, true, mode));
  const constraintSql = mode === 'full' ? serializeTableConstraints(table.constrains) : [];

  const allDefinitions = [...columnSql, ...constraintSql];
  return `CREATE TABLE ${table.dbName} (\n${allDefinitions.join(',\n')}\n);`;
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
    .filter(table => !(table.__meta__.derivedFrom && table.__meta__.derivedFrom.length > 0)) // Exclude derived tables
    .map((table) => tableMetaToSnapshot(table.__meta__))
    .sort((a, b) => a.dbName.localeCompare(b.dbName));
}

function buildColumnsSnapshot(columns: Record<string, ColumnMetadata | SerializableColumnMetadata>): Record<string, SerializableColumnMetadata> {
  const entries = Object.entries(columns)
    .map(([key, column]) => [key, cloneColumn(column)] as [string, SerializableColumnMetadata]);
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
    statements.push(...diffConstraints(prev, curr));
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

function diffConstraints(previous: TableSnapshot, current: TableSnapshot): string[] {
  const prevConstrains = previous.constrains ?? [];
  const currConstrains = current.constrains ?? [];

  if (!deepEqual(prevConstrains, currConstrains)) {
    throw new Error(`Constraint changes are not supported. Table '${current.name}' constraint changes detected.`);
  }

  return [];
}

function serializeColumnDefinition(column: SerializableColumnMetadata, indent = false, mode: 'full' | 'minimal' = 'full'): string {
  const parts: string[] = [column.dbName, column.type.toUpperCase()];

  if (column.generatedAlwaysAs) {
    parts.push(`GENERATED ALWAYS AS (${column.generatedAlwaysAs}) VIRTUAL`);
  } else {
    if (column.primaryKey) parts.push('PRIMARY KEY');
    if (column.notNull) parts.push('NOT NULL');
    if (mode === 'full') {
      if (column.unique) parts.push('UNIQUE');
      if (column.default !== undefined) parts.push(`DEFAULT ${formatDefaultValue(column.default)}`);
      if (column.foreignKey) {
        const [tableName, columnName] = column.foreignKey.split('.');
        parts.push(`REFERENCES ${tableName}(${columnName})`);
      }
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

function serializeTableConstraints(constrains?: ConstraintDefinition[]): string[] {
  if (!constrains || constrains.length === 0) return [];

  return constrains.map((constraint) => {
    const [type, ...columns] = constraint;
    const columnList = columns.join(', ');

    switch (type) {
      case 'primaryKey':
        return `  PRIMARY KEY (${columnList})`;
      case 'unique':
        return `  UNIQUE (${columnList})`;
      default:
        throw new Error(`Unknown constraint type: ${type}`);
    }
  });
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
