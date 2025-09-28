import type { ApplicationType, ColumnType, InsertionType, ColumnMetadata, SecurityCheckContext } from './types';
import { FilterObject, OrderObject, sql } from './utils/sql';
import type { RawSql } from './utils/sql';

export class Column<
  Name extends string = string,
  Type = unknown,
  InsertType extends InsertionType = 'optional'
  > {
  //#region DATA DEFINITION

  // override the ts type of the column
  $type<T>(): Column<Name, T, InsertType> {
    return new Column<Name, T, InsertType>({ kind: 'internal', meta: this.__meta__, table: this.__table__ });
  }

  // create a virtual/generated column
  generatedAlwaysAs(expression: string): Column<Name, Type, 'virtual'> {
    return this.cloneMeta<'virtual'>({ generatedAlwaysAs: expression, insertType: 'virtual' });
  }

  notNull(): Column<Name, Type, 'required'> {
    return this.cloneMeta<'required'>({ notNull: true, insertType: 'required' });
  }

  primaryKey(): Column<Name, Type, InsertType> {
    return this.cloneMeta({ primaryKey: true });
  }

  unique(): Column<Name, Type, InsertType> {
    return this.cloneMeta({ unique: true });
  }

  encode(fn: (data: unknown) => number | string): Column<Name, Type, InsertType> {
    return this.cloneMeta({ encode: fn });
  }

  decode(fn: (data: number | string) => unknown): Column<Name, Type, InsertType> {
    return this.cloneMeta({ decode: fn });
  }

  default(value: number | string | boolean | null): Column<Name, Type, 'withDefault'> {
    const encodedDefault = this.__meta__.encode ? this.__meta__.encode(value as unknown) : value;
    return new Column<Name, Type, 'withDefault'>({
      kind: 'internal',
      meta: Column.makeMeta(this.__meta__, { default: encodedDefault as any, appDefault: value, insertType: 'withDefault' }),
      table: this.__table__,
      valueSample: (this._valueSample ?? (value as any)) as any,
    });
  }

  renamedFrom(previousName: string): Column<Name, Type, InsertType> {
    return this.cloneMeta({ renamedFrom: previousName });
  }

  set(strings: TemplateStringsArray, ...values: any[]): Type {
    const processedValues = values.map((value) => {
      if (value instanceof Column) return value;
      if (value instanceof FilterObject) return value;
      if (value instanceof ColumnUpdateExpression) return value;
      return this.__meta__.encode ? this.__meta__.encode(value as any) : value;
    });
    const fragment = sql(strings, ...processedValues);
    return new ColumnUpdateExpression(fragment) as unknown as Type;
  }

  $defaultFn(fn: () => Type): Column<Name, Type, 'withDefault'> {
    return new Column<Name, Type, 'withDefault'>({
      kind: 'internal',
      meta: Column.makeMeta(this.__meta__, { appDefault: fn, insertType: 'withDefault' }),
      table: this.__table__,
      valueSample: fn as any,
    });
  }

  $onUpdateFn(fn: () => Type): Column<Name, Type, InsertType> {
    return this.cloneMeta({ appOnUpdate: fn });
  }

  references(get: () => Column<any, any, any>): Column<Name, Type, InsertType> {
    const target = get();
    const targetTable = target.__table__;
    if (!targetTable) {
      throw new Error('Referenced column must be attached to a table');
    }
    return this.cloneMeta({ foreignKey: `${targetTable.getDbName()}.${target.__meta__.dbName}` });
  }

  //#endregion

  //#region FILTERS

  eq(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      "=",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  ne(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      "!=",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  like(value: string) {
    return new FilterObject(
      "LIKE",
      this.getSqlColumnReference(),
      { type: "literal", value }
    );
  }

  notLike(value: string) {
    return new FilterObject(
      "NOT LIKE",
      this.getSqlColumnReference(),
      { type: "literal", value }
    );
  }

  gt(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      ">",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  gte(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      ">=",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  lt(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      "<",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  lte(value: Type) {
    const encoded = this.__meta__.encode ? this.__meta__.encode(value as unknown as any) : value;
    return new FilterObject(
      "<=",
      this.getSqlColumnReference(),
      { type: "literal", value: encoded }
    );
  }

  between(value1: Type, value2: Type) {
    const enc = (v: any) => (this.__meta__.encode ? this.__meta__.encode(v) : v);
    return new FilterObject(
      "BETWEEN",
      this.getSqlColumnReference(),
      { type: "literal", value: [enc(value1), enc(value2)] }
    );
  }

  notBetween(value1: Type, value2: Type) {
    const enc = (v: any) => (this.__meta__.encode ? this.__meta__.encode(v) : v);
    return new FilterObject(
      "NOT BETWEEN",
      this.getSqlColumnReference(),
      { type: "literal", value: [enc(value1), enc(value2)] }
    );
  }

  isNull() {
    return new FilterObject(
      "IS NULL",
      this.getSqlColumnReference()
    );
  }

  isNotNull() {
    return new FilterObject(
      "IS NOT NULL",
      this.getSqlColumnReference()
    );
  }

  inArray(values: Type[]) {
    const encValues = (values as any[]).map((v) => (this.__meta__.encode ? this.__meta__.encode(v) : v));
    return new FilterObject(
      "IN",
      this.getSqlColumnReference(),
      { type: "literal", value: encValues }
    );
  }

  notInArray(values: Type[]) {
    const encValues = (values as any[]).map((v) => (this.__meta__.encode ? this.__meta__.encode(v) : v));
    return new FilterObject(
      "NOT IN",
      this.getSqlColumnReference(),
      { type: "literal", value: encValues }
    );
  }

  //#endregion

  asc(): OrderObject {
    return new OrderObject(this.getSqlColumnReference(), "ASC");
  }

  desc(): OrderObject {
    return new OrderObject(this.getSqlColumnReference(), "DESC");
  }

  count(): Column<string, number, 'virtual'> {
    if (!this.__table__) {
      throw new Error('Column must be attached to a table to use count()');
    }
    return new Column<string, number, 'virtual'>({
      kind: 'internal',
      meta: {
        name: 'userCount',
        dbName: 'userCount',
        type: 'integer',
        insertType: 'virtual',
        definition: `COUNT(${this.__table__.getDbName()}.${this.__meta__.dbName})`
      },
      table: this.__table__
    });
  }

  max(): Column<string, Type, 'virtual'> {
    if (!this.__table__) {
      throw new Error('Column must be attached to a table to use max()');
    }
    return new Column<string, Type, 'virtual'>({
      kind: 'internal',
      meta: {
        name: 'maxValue',
        dbName: 'maxValue',
        type: this.__meta__.type,
        insertType: 'virtual',
        definition: `MAX(${this.__table__.getDbName()}.${this.__meta__.dbName})`
      },
      table: this.__table__
    });
  }

  increment(amount: number = 1): Column<string, number, 'virtual'> {
    if (!this.__table__) {
      throw new Error('Column must be attached to a table to use increment()');
    }
    return new Column<string, number, 'virtual'>({
      kind: 'internal',
      meta: {
        name: 'nextValue',
        dbName: 'nextValue',
        type: 'integer',
        insertType: 'virtual',
        definition: `${this.__table__.getDbName()}.${this.__meta__.dbName} + ${amount}`
      },
      table: this.__table__
    });
  }


  //#region SECURITY

  // check that where condition with = operator is present
  equalityCheck(value: Type): SecurityCheckContext {
    const tableName = this.__table__?.getName();
    if (!tableName) {
      throw new Error('Column must be attached to a table to use equalityCheck');
    }
    return {
      tableName,
      columnName: this.__meta__.name,
      value,
      operator: '='
    };
  }

  assertImmutable(data?: Record<string, unknown>, allowedValue?: Type) {
    if (!data) return

    if (this.__meta__.name in data) {
      if (data[this.__meta__.name] !== undefined && data[this.__meta__.name] !== allowedValue)
      throw new Error(`Column ${this.__meta__.name} is immutable`);
    }
  }

  //#endregion

  readonly __meta__: ColumnMetadata;
  __table__?: { getName: () => string; getDbName: () => string };
  private _valueSample?: Type | (() => Type);

  private static makeMeta(base: ColumnMetadata, partial?: Partial<ColumnMetadata>): ColumnMetadata {
    return { ...base, ...(partial || {}) } as ColumnMetadata;
  }

  constructor(init:
    | { kind: 'public'; name: Name; type: ColumnType; appType?: ApplicationType; appDefault?: Type | (() => Type); encode?: (data: Type) => number | string; decode?: (data: number | string) => Type }
    | { kind: 'internal'; meta: ColumnMetadata; table?: { getName: () => string; getDbName: () => string }; valueSample?: Type | (() => Type) }
  ) {
    if (init.kind === 'public') {
      this.__meta__ = {
        name: init.name,
        dbName: init.name,
        type: init.type,
        appType: init.appType,
        insertType: init.appDefault !== undefined ? 'required' : 'optional',
        appDefault: init.appDefault,
        encode: init.encode,
        decode: init.decode,
      } as ColumnMetadata;
      this._valueSample = init.appDefault;
    } else {
      this.__meta__ = init.meta;
      this.__table__ = init.table;
      this._valueSample = init.valueSample;
    }
  }

  private cloneMeta<M extends InsertionType = InsertType>(partial?: Partial<ColumnMetadata> & { insertType?: M }): Column<Name, Type, M> {
    return new Column<Name, Type, M>({
      kind: 'internal',
      meta: Column.makeMeta(this.__meta__, partial),
      table: this.__table__,
      valueSample: this._valueSample,
    });
  }

  private getSqlColumnReference() {
    if (!this.__table__) {
      throw new Error(`Column ${this.__meta__.name} must be attached to a table to build SQL expressions`);
    }

    return {
      type: 'column' as const,
      name: this.__meta__.dbName,
      table: this.__table__.getDbName(),
      runtime: {
        name: this.__meta__.name,
        table: this.__table__.getName(),
      },
    };
  }
}

export class ColumnUpdateExpression {
  constructor(private readonly fragment: RawSql) {}

  build(column: Column<any, any, any>): RawSql {
    return {
      query: `${column.__meta__.dbName} ${this.fragment.query}`.trim(),
      params: [...this.fragment.params],
    };
  }
}
