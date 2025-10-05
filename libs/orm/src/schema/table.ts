import { Column, ColumnUpdateExpression } from './column';
import { FilterObject, OrderObject, sql } from '../utils/sql';
import type { RawSql } from '../utils/sql';
import { toSnakeCase, camelCaseKeys } from '../utils/casing';
import { normalizeQueryAnalysisToRuntime } from '../true-sql/normalize-analysis';
import { analyze } from '../true-sql/analyze';
import { rawQueryToAst } from '../true-sql/raw-query-to-ast';
import { extractTables } from '../true-sql/extract-tables';
import { IndexDefinition, ConstraintDefinition, SecurityRule, QueryContext, TableMetadata, OrmDriver, ColumnMetadata } from './types';
import type { UseQueryOptions } from '../../../query-fe/src/use-query-types'
import type { UseMutationOptions } from '../../../query-fe/src/use-mutation-types'
import { s } from '@w/schema';
import type { Schema, ObjectSchema } from '@w/schema';

type ColumnLike = Column<any, any, any>;

export type ColumnsOnly<T> = OmitNever<{ [K in keyof T]: T[K] extends ColumnLike ? T[K] : never }>;

type RawSelectable<T> = {
  [K in keyof T]: T[K] extends Column<any, infer V, infer I>
    ? (I extends 'virtual' ? never :
       I extends 'required' ? V :
       I extends 'withDefault' ? V :
       V | undefined)
    : never;
};
type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

// Split required and optional fields for proper TypeScript handling
type RequiredInsertFields<T> = {
  [K in keyof T]: T[K] extends Column<any, infer V, infer I>
    ? I extends 'required' ? V : never
    : never;
};
type OptionalInsertFields<T> = {
  [K in keyof T]: T[K] extends Column<any, infer V, infer I>
    ? I extends 'optional' | 'withDefault' ? V : never
    : never;
};

export type SelectableForCols<T> = OmitNever<RawSelectable<T>>;
export type InsertableForCols<T> = OmitNever<RequiredInsertFields<T>> & Partial<OmitNever<OptionalInsertFields<T>>>;

type SelectColumnMap = Record<string, Column<any, any, any>>;

type ColumnSelectableValue<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer TValue, infer InsertType>
    ? InsertType extends 'optional'
      ? TValue | undefined
      : TValue
    : never;

type ColumnsSelectionResult<TColumns extends SelectColumnMap> = {
  [K in keyof TColumns]: TColumns[K] extends Column<any, any, any>
    ? ColumnSelectableValue<TColumns[K]>
    : never;
};

type SelectArgs<TColumnMap extends SelectColumnMap | undefined = undefined> = {
  columns?: TColumnMap;
  where?: RawSql | FilterObject;
  orderBy?: OrderObject | OrderObject[];
  limit?: number;
  offset?: number;
  groupBy?: Column<any, any, any> | Array<Column<any, any, any>>;
};

export interface TableConstructorOptions<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
  name: Name;
  columns: TCols;
  indexes?: IndexDefinition[];
  constrains?: ConstraintDefinition[];
}

export abstract class BaseTable<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
  readonly __meta__: TableMetadata;
  readonly __columns__: TCols;
  readonly __db__!: { getDriver: () => OrmDriver; getCurrentUser: () => any; getSchema: () => Record<string, Table<any, any>>; isProd: () => boolean };
  // type helpers exposed on instance for precise typing
  readonly __selectionType__!: SelectableForCols<TCols>;
  readonly __insertionType__!: InsertableForCols<TCols>;
  // schema properties for instant type extraction
  readonly __insertSchema__!: ObjectSchema<any>;
  readonly __updateSchema__!: ObjectSchema<any>;
  readonly __selectSchema__!: ObjectSchema<any>;
  protected _securityRules: SecurityRule[] = [];

  constructor(options: TableConstructorOptions<Name, TCols>) {
    const tableDbName = toSnakeCase(options.name);
    const columnMetadata: Record<string, ColumnMetadata> = {};
    Object.entries(options.columns).forEach(([key, col]) => {
      const columnDbName = toSnakeCase(key);
      col.__table__ = { getName: () => options.name, getDbName: () => tableDbName };
      col.__meta__.name = key as any;
      col.__meta__.dbName = columnDbName;
      (this as any)[key] = col;
      columnMetadata[key] = { ...col.__meta__, name: key, dbName: columnDbName } as ColumnMetadata;
    });

    this.__meta__ = {
      name: options.name,
      dbName: tableDbName,
      columns: columnMetadata,
      indexes: options.indexes ?? [],
      constrains: options.constrains ?? [],
    } as TableMetadata;

    this.__columns__ = options.columns;

    // Build schemas for type extraction
    const insertSchemaFields: Record<string, Schema> = {};
    const updateSchemaFields: Record<string, Schema> = {};
    const selectSchemaFields: Record<string, Schema> = {};

    Object.entries(options.columns).forEach(([key, col]) => {
      const meta = col.__meta__;

      // Skip virtual columns for insert/update
      if (meta.insertType === 'virtual') {
        return;
      }

      // Build the base schema for this column
      let columnSchema: Schema;

      if (meta.jsonSchema) {
        columnSchema = meta.jsonSchema;
      } else if (meta.appType === 'date') {
        columnSchema = s.date();
      } else if (meta.appType === 'boolean') {
        columnSchema = s.boolean();
      } else if (meta.appType === 'enum' && meta.enumValues) {
        columnSchema = s.enum(meta.enumValues as any);
      } else {
        // Use SQL type as fallback
        switch (meta.type) {
          case 'text':
            columnSchema = s.string();
            break;
          case 'integer':
          case 'real':
            columnSchema = s.number();
            break;
          default:
            columnSchema = s.string();
        }
      }

      // Handle insert schema (required/optional based on insertType)
      if (meta.insertType === 'required') {
        insertSchemaFields[key] = columnSchema;
      } else {
        // optional or withDefault
        insertSchemaFields[key] = s.optional(columnSchema);
      }

      // Update schema - all non-virtual columns are optional
      updateSchemaFields[key] = s.optional(columnSchema);

      // Select schema - handle nullable/optional
      if (meta.insertType === 'optional') {
        selectSchemaFields[key] = s.optional(columnSchema);
      } else {
        selectSchemaFields[key] = columnSchema;
      }
    });

    (this as any).__insertSchema__ = s.object(insertSchemaFields);
    (this as any).__updateSchema__ = s.object(updateSchemaFields);
    (this as any).__selectSchema__ = s.object(selectSchemaFields);
  }

  as<Alias extends string>(alias: Alias): Table<Alias, TCols> & TCols {
    const clonedColumns = Object.fromEntries(
      Object.entries(this.__meta__.columns).map(([key, meta]) => {
        const original = (this as any)[key] as Column<any, any, any>;
        const cloned = new Column({ kind: 'internal', meta: { ...meta }, table: original.__table__ });
        return [key, cloned];
      })
    ) as TCols;
    const aliased = new Table<Alias, TCols>({
      name: alias as any,
      columns: clonedColumns,
      indexes: this.__meta__.indexes ?? [],
      constrains: this.__meta__.constrains ?? [],
    }) as any;
    (aliased as any).__meta__.aliasedFrom = this.__meta__.name;
    Object.entries(clonedColumns).forEach(([key, col]) => {
      aliased[key] = col as any;
    });
    // Set __columns__ to the cloned column objects (not metadata)
    (aliased as any).__columns__ = clonedColumns;
    return aliased as Table<Alias, TCols> & TCols;
  }

  select<
    TColMap extends SelectColumnMap | undefined = undefined
    >(options?: SelectArgs<TColMap>): SelectQueryBuilder<
    this,
    TColMap,
      JoinedTables<{ [K in Name]: this }>,
    'columns'
  > {
    return new SelectQueryBuilder(
      this,
      undefined,
      options
    ) as any;
  }

  make<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides?: Partial<InsertableForCols<TSelfCols>>
  ): SelectableForCols<TSelfCols> {
    const result: Record<string, unknown> = {};
    const normalizedOverrides = (overrides ?? {}) as Partial<InsertableForCols<TSelfCols>>;
    const colsMeta = this.__meta__.columns;

    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col) continue;
      // skip virtual columns
      if (col.__meta__.insertType === 'virtual') continue;

      if (Object.prototype.hasOwnProperty.call(normalizedOverrides, key) && (normalizedOverrides as any)[key] !== undefined) {
        (result as any)[key] = (normalizedOverrides as any)[key];
        continue;
      }

      const appDef = col.__meta__.appDefault;
      if (appDef !== undefined) {
        (result as any)[key] = typeof appDef === 'function' ? (appDef as () => unknown)() : appDef;
        continue;
      }
      const derivedDefault = deriveImplicitDefault(col);
      if (derivedDefault !== undefined) {
        (result as any)[key] = derivedDefault;
        continue;
      }
      // leave undefined when no override or app default
      (result as any)[key] = undefined;
    }

    return result as any;
  }

  secure<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>, TUser = any>(rule: SecurityRule<TUser, Partial<InsertableForCols<TSelfCols>>>): this {
    this._securityRules.push(rule as SecurityRule);
    return this;
  }

  renamedFrom(previousName: string): this {
    this.__meta__.renamedFrom = previousName;
    return this;
  }

  async enforceSecurityRules<TUser = any>(queryContext: QueryContext, user: TUser): Promise<void> {
    for (const rule of this._securityRules) {
      try {
        const allowed = await rule(queryContext, user);
        if (allowed === false) {
          throw new Error(`Security rule returned false for ${queryContext.type} operation on table ${this.__meta__.name}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
      }
    }
  }

  protected async checkSecurity<TUser = any>(rawSql: RawSql, data?: any): Promise<void> {
    const user = this.__db__.getCurrentUser();
    const analysis = normalizeQueryAnalysisToRuntime(analyze(rawSql), this.__db__.getSchema());
    const accessedTables = Array.from(new Set(analysis.accessedTables.map((table) => table.name)));

    const queryContext: QueryContext = {
      type: analysis.type,
      accessedTables,
      data,
      analysis
    };

    await this.enforceSecurityRules(queryContext, user);
  }
}

export class Table<Name extends string, TCols extends Record<string, Column<any, any, any>>> extends BaseTable<Name, TCols> {
  //#region MUTATIONS

  async insert<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    data: InsertableForCols<TSelfCols>
  ): Promise<SelectableForCols<TSelfCols>> {
    const driver = this.__db__.getDriver();

    // build full app-level object using defaults
    const dataToInsert = this.make(data as any) as SelectableForCols<TSelfCols>;

    const colsMeta = this.__meta__.columns;
    const columnNames: string[] = [];
    const params: any[] = [];
    const debugParams: any[] = [];

    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType === 'virtual') continue;

      const value = (dataToInsert as any)[key];
      if (value === undefined) continue; // omit undefined to allow DB defaults
      const encoded = col.__meta__.encode ? col.__meta__.encode(value as any) : value;
      columnNames.push(col.__meta__.dbName);
      params.push(encoded);
      debugParams.push(value); // Store the original unencoded value for debugging
    }

    // Validate missing required columns
    const missingRequired: string[] = [];
    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType !== 'required') continue;
      const value = (dataToInsert as any)[key];
      if (value === undefined) missingRequired.push(key);
    }
    if (missingRequired.length > 0) {
      throw new Error(`Missing required columns: ${missingRequired.join(', ')}`);
    }

    if (columnNames.length === 0) {
      throw new Error('No columns to insert');
    }

    // Generate raw SQL INSERT statement
    const placeholders = params.map(() => '?').join(', ');
    const query = `INSERT INTO ${this.__meta__.dbName} (${columnNames.join(', ')}) VALUES (${placeholders})`;
    const isProd = this.__db__.isProd();
    const fullQuery = isProd ? { query, params } : { query, params, debugParams };

    await this.checkSecurity(fullQuery, dataToInsert);

    await driver.run(fullQuery);

    return dataToInsert;
  }

  async insertMany<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    data: InsertableForCols<TSelfCols>[]
  ): Promise<SelectableForCols<TSelfCols>[]> {
    const results: SelectableForCols<TSelfCols>[] = [] as any;
    for (const datum of data) {
      const inserted = await this.insert(datum);
      results.push(inserted as any);
    }
    return results;
  }

  async update<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    options: {
      data: Partial<InsertableForCols<TSelfCols>>;
      where: RawSql | FilterObject;
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver();
    const colsMeta = this.__meta__.columns;

    const whereClause = options.where instanceof FilterObject ? sql`${options.where}` : options.where;

    // Apply onUpdate functions first
    const updatedData: Record<string, unknown> = { ...options.data };
    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType === 'virtual') continue;

      // If column has onUpdate function, call it
      if (col.__meta__.appOnUpdate && typeof col.__meta__.appOnUpdate === 'function') {
        updatedData[key] = (col.__meta__.appOnUpdate as () => unknown)();
      }
    }

    const setClause: string[] = [];
    const params: any[] = [];
    const debugParams: any[] = [];

    // Build SET clause from data
    for (const [key, value] of Object.entries(updatedData)) {
      if (value === undefined) continue;
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType === 'virtual') continue;

      if (value instanceof ColumnUpdateExpression) {
        const expressionSql = value.build(col);
        setClause.push(`${col.__meta__.dbName} = ${expressionSql.query}`);
        params.push(...expressionSql.params);
        debugParams.push(...expressionSql.params); // For expressions, use the same params
        continue;
      }

      const encoded = col.__meta__.encode ? col.__meta__.encode(value as any) : value;
      setClause.push(`${col.__meta__.dbName} = ?`);
      params.push(encoded);
      debugParams.push(value); // Store the original unencoded value for debugging
    }

    if (setClause.length === 0) {
      throw new Error('No columns to update');
    }

    // Add WHERE clause parameters
    params.push(...whereClause.params);
    debugParams.push(...(whereClause.debugParams ?? whereClause.params));

    const query = `UPDATE ${this.__meta__.dbName} SET ${setClause.join(', ')} WHERE ${whereClause.query}`;
    const isProd = this.__db__.isProd();
    const fullQuery = isProd ? { query, params } : { query, params, debugParams };

    // Parse for security analysis and check security
    await this.checkSecurity(fullQuery, updatedData);

    await driver.run(fullQuery);
  }

  async delete<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    options: {
      where: RawSql | FilterObject;
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver();

    const whereClause = options.where instanceof FilterObject ? sql`${options.where}` : options.where;

    const query = `DELETE FROM ${this.__meta__.dbName} WHERE ${whereClause.query}`;
    const params = [...whereClause.params];
    const debugParams = [...(whereClause.debugParams ?? whereClause.params)];
    const isProd = this.__db__.isProd();
    const fullQuery = isProd ? { query, params } : { query, params, debugParams };

    // Parse for security analysis and check security
    await this.checkSecurity(fullQuery);

    await driver.run(fullQuery);
  }

  insertOptions<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides?: Partial<Omit<UseMutationOptions<SelectableForCols<TSelfCols>, InsertableForCols<TSelfCols>>, 'mutationFn' | 'invalidates'>>
  ): UseMutationOptions<SelectableForCols<TSelfCols>, InsertableForCols<TSelfCols>> {
    const invalidates = [this.__meta__.name];
    return {
      ...overrides,
      mutationFn: (data: InsertableForCols<TSelfCols>) => this.insert(data),
      invalidates,
    };
  }

  insertManyOptions<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides?: Partial<Omit<UseMutationOptions<SelectableForCols<TSelfCols>[], InsertableForCols<TSelfCols>[]>, 'mutationFn' | 'invalidates'>>
  ): UseMutationOptions<SelectableForCols<TSelfCols>[], InsertableForCols<TSelfCols>[]> {
    const invalidates = [this.__meta__.name];
    return {
      ...overrides,
      mutationFn: (data: InsertableForCols<TSelfCols>[]) => this.insertMany(data),
      invalidates,
    };
  }

  updateOptions<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides?: Partial<Omit<UseMutationOptions<void, { data: Partial<InsertableForCols<TSelfCols>>; where: RawSql | FilterObject }>, 'mutationFn' | 'invalidates'>>
  ): UseMutationOptions<void, { data: Partial<InsertableForCols<TSelfCols>>; where: RawSql | FilterObject }> {
    const invalidates = [this.__meta__.name];
    return {
      ...overrides,
      mutationFn: (options: { data: Partial<InsertableForCols<TSelfCols>>; where: RawSql | FilterObject }) => this.update(options),
      invalidates,
    };
  }

  deleteOptions<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides?: Partial<Omit<UseMutationOptions<void, { where: RawSql | FilterObject }>, 'mutationFn' | 'invalidates'>>
  ): UseMutationOptions<void, { where: RawSql | FilterObject }> {
    const invalidates = [this.__meta__.name];
    return {
      ...overrides,
      mutationFn: (options: { where: RawSql | FilterObject }) => this.delete(options),
      invalidates,
    };
  }

  //#endregion
}

type JoinedTables<
  Tables extends Record<string, BaseTable<any, any>>
> = {
  __tables__: Tables;
};

type JoinResult<
  T1 extends BaseTable<any, any> | JoinedTables<any>,
  T2 extends BaseTable<any, any> | JoinedTables<any>
> =
  // Preserve actual table types using conditional inference
  T1 extends infer T1Actual extends BaseTable<any, any>
    ? T2 extends infer T2Actual extends BaseTable<any, any>
      ? T1Actual extends BaseTable<infer N1 extends string, any>
        ? T2Actual extends BaseTable<infer N2 extends string, any>
          ? JoinedTables<{
              [K in N1]: T1Actual;
            } & {
              [K in N2]: T2Actual;
            }>
          : never
        : never
      : T1Actual extends BaseTable<infer N1 extends string, any>
      ? T2 extends JoinedTables<infer Ts>
        ? JoinedTables<{ [K in N1]: T1Actual } & Ts>
        : never
      : never
    : T1 extends JoinedTables<infer Ts>
    ? T2 extends infer T2Actual extends BaseTable<any, any>
      ? T2Actual extends BaseTable<infer N2 extends string, any>
        ? JoinedTables<Ts & { [K in N2]: T2Actual }>
        : never
      : never
    : never;

type JoinedSelection<JTs extends JoinedTables<any>> = {
  [K in keyof JTs['__tables__']]:
    JTs['__tables__'][K] extends BaseTable<any, infer Cols>
      ? ColumnsSelectionResult<Cols>
      : never;
};

type SelectResult<
  TColumnMap extends SelectColumnMap,
  TJoined extends JoinedTables<any>,
  TMode extends SelectionMode
> = TMode extends 'columns'
  ? ColumnsSelectionResult<TColumnMap> // flat join via explicit column map
  : JoinedSelection<TJoined>; // normal join selection (grouped by table)

type SelectionMode = 'columns' | 'tables';

export class SelectQueryBuilder<
  TSource extends BaseTable<any, any>,
  TColMapOrDefault extends SelectColumnMap | undefined,
  TJoined extends JoinedTables<any>,
  TMode extends SelectionMode
> {
  private joinClauses: Array<{ type: 'INNER' | 'LEFT'; table: BaseTable<any, any>; on: RawSql }> = [];

  constructor(
    private source: TSource,
    private joined: TJoined | undefined,
    private selectArgs?: SelectArgs<TColMapOrDefault>
  ) {}

  join<TJoin extends BaseTable<any, any>>(other: TJoin, on: FilterObject): SelectQueryBuilder<
    TSource,
    TColMapOrDefault,
    JoinResult<TJoined, TJoin>,
    TColMapOrDefault extends undefined ? 'tables' : 'columns'
    >{
    const builder = new SelectQueryBuilder(this.source, this.joined, this.selectArgs) as any;
    builder.joinClauses = [...this.joinClauses, { type: 'INNER', table: other, on: sql`${on}` }];
    return builder;
  };

  leftJoin<TJoin extends BaseTable<any, any>>(other: TJoin, on: FilterObject): SelectQueryBuilder<
    TSource,
    TColMapOrDefault,
    JoinResult<TJoined, TJoin>,
    TColMapOrDefault extends undefined ? 'tables' : 'columns'
    >{
    const builder = new SelectQueryBuilder(this.source, this.joined, this.selectArgs) as any;
    builder.joinClauses = [...this.joinClauses, { type: 'LEFT', table: other, on: sql`${on}` }];
    return builder;
  };

  async execute(): Promise<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>[]> {
    const driver = this.source.__db__.getDriver();
    const query = this.buildQuery();

    // Security check
    const user = this.source.__db__.getCurrentUser();
    const analysis = normalizeQueryAnalysisToRuntime(analyze(query), this.source.__db__.getSchema());
    const accessedTables = Array.from(new Set(analysis.accessedTables.map((table) => table.name)));

    const queryContext: QueryContext = {
      type: analysis.type,
      accessedTables,
      analysis
    };

    await this.source.enforceSecurityRules(queryContext, user);

    const rawResults = await driver.run(query);

    return this.processResults(rawResults);
  }

  async executeAndTakeFirst(): Promise<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>> {
    const results = await this.execute();
    if (results.length === 0) {
      throw new Error('No rows found');
    }
    return results[0];
  }

  toAst() {
    const query = this.buildQuery();
    return rawQueryToAst(query);
  }

  options(overrides?: Partial<Omit<UseQueryOptions<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>[]>, 'queryKey' | 'queryFn'>>): UseQueryOptions<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>[]> {
    const query = this.buildQuery();
    const depends = extractTables(query);
    return {
      queryKey: [query.query, ...query.params],
      queryFn: () => this.execute(),
      depends,
      ...overrides,
    };
  }

  private buildQuery(): RawSql {
    const parts: string[] = [];
    const params: any[] = [];

    // SELECT clause
    if (this.selectArgs?.columns) {
      const columnParts: string[] = [];
      Object.entries(this.selectArgs.columns).forEach(([alias, column]) => {
        if (column.__meta__.definition) {
          columnParts.push(`${column.__meta__.definition} AS ${alias}`);
        } else {
          const table = column.__table__;
          if (table) {
            columnParts.push(`${table.getDbName()}.${column.__meta__.dbName} AS ${alias}`);
          }
        }
      });
      parts.push(`SELECT ${columnParts.join(', ')}`);
    } else {
      // Select all columns from source table and joined tables
      const columnParts: string[] = [];

      if (this.joinClauses.length > 0) {
        // For joins, use aliases to avoid column name conflicts
        // Add source table columns with alias
        Object.entries(this.source.__meta__.columns).forEach(([key, meta]) => {
          if (meta.insertType !== 'virtual') {
            const alias = `${this.source.__meta__.name}_${meta.dbName}`;
            columnParts.push(`${this.source.__meta__.dbName}.${meta.dbName} AS ${alias}`);
          }
        });

        // Add joined table columns with alias
        this.joinClauses.forEach(({ table }) => {
          Object.entries(table.__meta__.columns).forEach(([key, meta]) => {
            if (meta.insertType !== 'virtual') {
              const alias = `${table.__meta__.name}_${meta.dbName}`;
              columnParts.push(`${table.__meta__.dbName}.${meta.dbName} AS ${alias}`);
            }
          });
        });
      } else {
        // For simple selects, no need for aliases
        Object.entries(this.source.__meta__.columns).forEach(([key, meta]) => {
          if (meta.insertType !== 'virtual') {
            columnParts.push(`${this.source.__meta__.dbName}.${meta.dbName}`);
          }
        });
      }

      parts.push(`SELECT ${columnParts.join(', ')}`);
    }

    // FROM clause
    parts.push(`FROM ${this.source.__meta__.dbName}`);

    // JOIN clauses
    this.joinClauses.forEach(({ type, table, on }) => {
      const tableRef = table.__meta__.aliasedFrom ? `${table.__meta__.aliasedFrom} AS ${table.__meta__.dbName}` : table.__meta__.dbName;
      const joinType = type === 'INNER' ? 'INNER JOIN' : 'LEFT JOIN';
      parts.push(`${joinType} ${tableRef} ON ${on.query}`);
      params.push(...on.params);
    });

    // WHERE clause
    if (this.selectArgs?.where) {
      const whereClause = this.selectArgs.where instanceof FilterObject ? sql`${this.selectArgs.where}` : this.selectArgs.where;
      parts.push(`WHERE ${whereClause.query}`);
      params.push(...whereClause.params);
    }

    // GROUP BY clause
    if (this.selectArgs?.groupBy) {
      const groupByCols = Array.isArray(this.selectArgs.groupBy) ? this.selectArgs.groupBy : [this.selectArgs.groupBy];
      const groupByParts = groupByCols.map(col => {
        const table = col.__table__;
        return table ? `${table.getDbName()}.${col.__meta__.dbName}` : col.__meta__.dbName;
      });
      parts.push(`GROUP BY ${groupByParts.join(', ')}`);
    }

    // ORDER BY clause
    if (this.selectArgs?.orderBy) {
      const orderByClauses = Array.isArray(this.selectArgs.orderBy) ? this.selectArgs.orderBy : [this.selectArgs.orderBy];
      const orderByParts = orderByClauses.map(order => {
        const orderSql = sql`${order}`;
        params.push(...orderSql.params);
        return orderSql.query;
      });
      parts.push(`ORDER BY ${orderByParts.join(', ')}`);
    }

    // LIMIT clause
    if (this.selectArgs?.limit !== undefined) {
      parts.push(`LIMIT ?`);
      params.push(this.selectArgs.limit);
    }

    // OFFSET clause
    if (this.selectArgs?.offset !== undefined) {
      parts.push(`OFFSET ?`);
      params.push(this.selectArgs.offset);
    }

    return { query: parts.join(' '), params };
  }

  private processResults(rawResults: any[]): any[] {
    if (this.selectArgs?.columns) {
      // For explicit column selection, return flat objects
      return rawResults.map(row => {
        const result: any = {};
        Object.entries(this.selectArgs!.columns!).forEach(([alias, column]) => {
          let value = row[alias];
          if (column.__meta__.decode && value !== null && value !== undefined) {
            value = column.__meta__.decode(value);
          }
          result[alias] = value;
        });
        return result;
      });
    } else if (this.joinClauses.length > 0) {
      // For joins without explicit columns, group by table
      return rawResults.map(row => {
        const result: any = {};

        // Process source table
        const sourceData: any = {};
        Object.entries(this.source.__meta__.columns).forEach(([key, meta]) => {
          if (meta.insertType !== 'virtual') {
            const alias = `${this.source.__meta__.name}_${meta.dbName}`;
            let value = row[alias];
            if (meta.decode && value !== null && value !== undefined) {
              value = meta.decode(value);
            }
            sourceData[key] = value;
          }
        });
        result[this.source.__meta__.name] = sourceData;

        // Process joined tables
        this.joinClauses.forEach(({ table }) => {
          const tableData: any = {};
          Object.entries(table.__meta__.columns).forEach(([key, meta]) => {
            if (meta.insertType !== 'virtual') {
              const alias = `${table.__meta__.name}_${meta.dbName}`;
              let value = row[alias];
              if (meta.decode && value !== null && value !== undefined) {
                value = meta.decode(value);
              }
              tableData[key] = value;
            }
          });
          result[table.__meta__.name] = tableData;
        });

        return result;
      });
    } else {
      // For simple selects, return flat objects with source table data
      return rawResults.map(row => {
        const result: any = {};
        Object.entries(this.source.__meta__.columns).forEach(([key, meta]) => {
          if (meta.insertType !== 'virtual') {
            // Use alias if there are joins, otherwise use the original column name
            const columnKey = this.joinClauses.length > 0 ? `${this.source.__meta__.name}_${meta.dbName}` : meta.dbName;
            let value = row[columnKey];
            if (meta.decode && value !== null && value !== undefined) {
              value = meta.decode(value);
            }
            result[key] = value;
          }
        });
        return result;
      });
    }
  }
}

export class IndexBuilder {
  private index: IndexDefinition = { columns: [], unique: false };

  unique(): this {
    this.index.unique = true;
    return this;
  }

  on(...columns: Column[]): IndexDefinition {
    this.index.columns = columns.map((c) => c.__meta__.dbName);
    return { ...this.index };
  }
}

function deriveImplicitDefault(column: Column<any, any, any>): unknown {
  const meta = column.__meta__;

  switch (meta.appType) {
    case 'json':
      // For JSON columns, try to derive a default from the schema
      // For now, just return empty object
      return {};
    case 'date':
      return new Date();
    case 'boolean':
      return false;
    case 'enum':
      if (meta.enumValues && meta.enumValues.length > 0) {
        return meta.enumValues[0];
      }
      break;
  }

  switch (meta.type) {
    case 'text':
      return '';
    case 'integer':
    case 'real':
      return 0;
  }

  return undefined;
}
