import { Column, ColumnUpdateExpression } from './column';
import type { IndexDefinition, TableMetadata, ColumnMetadata, BinDriver, SecurityRule, QueryContext, ConstraintDefinition } from './types';
import { FilterObject, OrderObject, sql } from './utils/sql';
import type { RawSql } from './utils/sql';
import { analyze } from './security/analyze';
import { toSnakeCase } from './utils/casing';
import { normalizeQueryAnalysisToRuntime } from './security/normalize-analysis';
import { getDefaultValueFromZodSchema } from './zod-integration/get-default-value-from-zod-schema';

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

export class Table<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
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
    // aliased.__columns__ = aliased.__meta__.columns; // TODO: fix this
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
      { __tables__: { [this.__meta__.name]: this } } as any,
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

    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType === 'virtual') continue;

      const value = (dataToInsert as any)[key];
      if (value === undefined) continue; // omit undefined to allow DB defaults
      const encoded = col.__meta__.encode ? col.__meta__.encode(value as any) : value;
      columnNames.push(col.__meta__.dbName);
      params.push(encoded);
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
    const fullQuery = { query, params };

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

    // Build SET clause from data
    for (const [key, value] of Object.entries(updatedData)) {
      if (value === undefined) continue;
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col || col.__meta__.insertType === 'virtual') continue;

      if (value instanceof ColumnUpdateExpression) {
        const expressionSql = value.build(col);
        setClause.push(`${col.__meta__.dbName} = ${expressionSql.query}`);
        params.push(...expressionSql.params);
        continue;
      }

      const encoded = col.__meta__.encode ? col.__meta__.encode(value as any) : value;
      setClause.push(`${col.__meta__.dbName} = ?`);
      params.push(encoded);
    }

    if (setClause.length === 0) {
      throw new Error('No columns to update');
    }

    // Add WHERE clause parameters
    params.push(...whereClause.params);

    const query = `UPDATE ${this.__meta__.dbName} SET ${setClause.join(', ')} WHERE ${whereClause.query}`;
    const fullQuery = { query, params };

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
    const fullQuery = { query, params };

    // Parse for security analysis and check security
    await this.checkSecurity(fullQuery);

    await driver.run(fullQuery);
  }

  //#endregion

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

  private async checkSecurity<TUser = any>(rawSql: RawSql, data?: any): Promise<void> {
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

  readonly __meta__: TableMetadata;
  readonly __columns__: TCols;
  readonly __db__!: { getDriver: () => BinDriver; getCurrentUser: () => any; getSchema: () => Record<string, Table<any, any>> };
  // type helpers exposed on instance for precise typing
  readonly __selectionType__!: SelectableForCols<TCols>;
  readonly __insertionType__!: InsertableForCols<TCols>;
  private _securityRules: SecurityRule[] = [];

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

    this.__columns__ = options.columns
  }
}

type JoinedTables<
  Tables extends Record<string, Table<any, any>>
> = {
  __tables__: Tables;
};

type JoinResult<
  T1 extends Table<any, any> | JoinedTables<any>,
  T2 extends Table<any, any> | JoinedTables<any>
> =
  // Table × Table
  T1 extends Table<infer N1 extends string, infer C1>
    ? T2 extends Table<infer N2 extends string, infer C2>
      ? JoinedTables<{
          [K in N1]: Table<N1, C1>;
        } & {
          [K in N2]: Table<N2, C2>;
        }>
      : never
    // JoinedTables × Table
    : T1 extends JoinedTables<infer Ts>
    ? T2 extends Table<infer N2 extends string, infer C2>
      ? JoinedTables<Ts & { [K in N2]: Table<N2, C2> }>
      : never
    // Table × JoinedTables
    : T1 extends Table<infer N1 extends string, infer C1>
    ? T2 extends JoinedTables<infer Ts>
      ? JoinedTables<{ [K in N1]: Table<N1, C1> } & Ts>
      : never
    : never;

type JoinedSelection<JTs extends JoinedTables<any>> = {
  [K in keyof JTs['__tables__']]:
    JTs['__tables__'][K] extends Table<any, infer Cols>
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
  TSource extends Table<any, any>,
  TColMapOrDefault extends SelectColumnMap | undefined,
  TJoined extends JoinedTables<any>,
  TMode extends SelectionMode
> {
  constructor(
    private source: TSource,
    private joined: TJoined | undefined,
    private options?: SelectArgs<TColMapOrDefault>
  ) {}

  join<TJoin extends Table<any, any>>(other: TJoin, on: any): SelectQueryBuilder<
    TSource,
    TColMapOrDefault,
    JoinResult<TJoined, TJoin>,
    TColMapOrDefault extends undefined ? 'tables' : 'columns'
    >{
    return new SelectQueryBuilder(this.source, other as any, this.options) as any; // TODO: fix
  };

  leftJoin<TJoin extends Table<any, any>>(other: TJoin, on: any): SelectQueryBuilder<
    TSource,
    TColMapOrDefault,
    JoinResult<TJoined, TJoin>,
    TColMapOrDefault extends undefined ? 'tables' : 'columns'
    >{
    return new SelectQueryBuilder(this.source, other as any, this.options) as any; // TODO: fix
  };

  async execute(): Promise<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>[]> {
    throw new Error("not implemented");
  }

  async executeAndTakeFirst(): Promise<SelectResult<TColMapOrDefault extends undefined ? TSource['__columns__'] : TColMapOrDefault, TJoined, TMode>> {
    throw new Error("not implemented");
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
      if (meta.jsonSchema) {
        return getDefaultValueFromZodSchema(meta.jsonSchema);
      }
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
