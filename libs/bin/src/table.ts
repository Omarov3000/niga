import { Column } from './column';
import type { IndexDefinition, TableMetadata, ColumnMetadata, BinDriver, SecurityRule, QueryContext, QueryType } from './types';
import type { RawSql } from './utils/sql';
import { rawQueryToSelectQuery, type SqlQuery } from './security/rawQueryToSelectQuery';

type ColumnLike = Column<any, any, any>;

type ColumnsOnly<T> = OmitNever<{ [K in keyof T]: T[K] extends ColumnLike ? T[K] : never }>;

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

export interface TableConstructorOptions<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
  name: Name;
  columns: TCols;
  indexes?: IndexDefinition[];
}

export class Table<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
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

      // TODO: if appDefault is not set return
      // for text = '', for numbers = 0, for boolean = false, for json - getDefaultValueFromZodSchema, for date new Date()
      const appDef = col.__meta__.appDefault;
      if (appDef !== undefined) {
        (result as any)[key] = typeof appDef === 'function' ? (appDef as () => unknown)() : appDef;
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
      columnNames.push(key);
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
    const query = `INSERT INTO ${this.__meta__.name} (${columnNames.join(', ')}) VALUES (${placeholders})`;
    const fullQuery = { query, params };

    // Parse for security analysis and check security
    const sqlQuery = rawQueryToSelectQuery(fullQuery);
    await this.checkSecurity(sqlQuery, dataToInsert);

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
      where: RawSql;
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver();
    const colsMeta = this.__meta__.columns;

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

      const encoded = col.__meta__.encode ? col.__meta__.encode(value as any) : value;
      setClause.push(`${key} = ?`);
      params.push(encoded);
    }

    if (setClause.length === 0) {
      throw new Error('No columns to update');
    }

    // Add WHERE clause parameters
    params.push(...options.where.params);

    const query = `UPDATE ${this.__meta__.name} SET ${setClause.join(', ')} WHERE ${options.where.query}`;
    const fullQuery = { query, params };

    // Parse for security analysis and check security
    const sqlQuery = rawQueryToSelectQuery(fullQuery);
    await this.checkSecurity(sqlQuery, updatedData);

    await driver.run(fullQuery);
  }

  async delete<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    options: {
      where: RawSql;
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver();

    const query = `DELETE FROM ${this.__meta__.name} WHERE ${options.where.query}`;
    const params = [...options.where.params];
    const fullQuery = { query, params };

    // Parse for security analysis and check security
    const sqlQuery = rawQueryToSelectQuery(fullQuery);
    await this.checkSecurity(sqlQuery);

    await driver.run(fullQuery);
  }

  //#endregion

  secure<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>, TUser = any>(rule: SecurityRule<TUser, Partial<InsertableForCols<TSelfCols>>>): this {
    this._securityRules.push(rule as SecurityRule);
    return this;
  }

  private async checkSecurity<TUser = any>(sqlQuery: SqlQuery, data?: any): Promise<void> {
    const user = this.__db__.getCurrentUser();

    let queryType: QueryType;
    let accessedTables = [this.__meta__.name];

    // Extract query type and accessed tables from the parsed SQL query
    switch (sqlQuery.type) {
      case 'insert':
        queryType = 'insert';
        accessedTables = [sqlQuery.table.name];
        break;
      case 'update':
        queryType = 'update';
        accessedTables = [sqlQuery.table.name];
        break;
      case 'delete':
        queryType = 'delete';
        accessedTables = [sqlQuery.table.name];
        break;
      case 'select':
      case 'compound_select':
        queryType = 'select';
        // For SELECT queries, we'd need more complex analysis
        // For now, keep the default behavior
        break;
      default:
        throw new Error(`Unsupported query type: ${(sqlQuery as any).type}`);
    }

    const queryContext: QueryContext = {
      type: queryType,
      accessedTables,
      data
    };

    for (const rule of this._securityRules) {
      const allowed = await rule(queryContext, user);
      if (allowed === false) {
        throw new Error(`Security check failed for ${queryType} operation on table ${this.__meta__.name}`);
      }
    }
  }

  readonly __meta__: TableMetadata;
  readonly __db__!: { getDriver: () => BinDriver; getCurrentUser: () => any };
  // type helpers exposed on instance for precise typing
  readonly __selectionType__!: SelectableForCols<TCols>;
  readonly __insertionType__!: InsertableForCols<TCols>;
  private _securityRules: SecurityRule[] = [];

  constructor(options: TableConstructorOptions<Name, TCols>) {
    const columnMetadata: Record<string, ColumnMetadata> = {};
    Object.entries(options.columns).forEach(([key, col]) => {
      col.__table__ = { getName: () => options.name };
      (this as any)[key] = col;
      columnMetadata[key] = { ...col.__meta__, name: key } as ColumnMetadata;
    });

    this.__meta__ = {
      name: options.name,
      columns: columnMetadata,
      indexes: options.indexes ?? [],
    } as TableMetadata;
  }
}

export class IndexBuilder {
  private index: IndexDefinition = { columns: [], unique: false };

  unique(): this {
    this.index.unique = true;
    return this;
  }

  on(...columns: Column[]): IndexDefinition {
    this.index.columns = columns.map((c) => c.__meta__.name);
    return { ...this.index };
  }
}
