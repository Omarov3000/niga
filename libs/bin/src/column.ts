import type { ApplicationType, ColumnType, InsertionType, ColumnMetadata } from './types';

export class Column<
  Name extends string = string,
  Type = unknown,
  InsertType extends InsertionType = 'optional'
> {
  readonly __meta__: ColumnMetadata;
  __table__?: { getName: () => string };
  private _valueSample?: Type | (() => Type);

  private static makeMeta(base: ColumnMetadata, partial?: Partial<ColumnMetadata>): ColumnMetadata {
    return { ...base, ...(partial || {}) } as ColumnMetadata;
  }

  constructor(init:
    | { kind: 'public'; name: Name; type: ColumnType; appType?: ApplicationType; appDefault?: Type | (() => Type) }
    | { kind: 'internal'; meta: ColumnMetadata; table?: { getName: () => string }; valueSample?: Type | (() => Type) }
  ) {
    if (init.kind === 'public') {
      this.__meta__ = {
        name: init.name,
        type: init.type,
        appType: init.appType,
        insertType: 'optional',
        appDefault: init.appDefault,
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

  $type<T>(): Column<Name, T, InsertType> {
    return new Column<Name, T, InsertType>({ kind: 'internal', meta: this.__meta__, table: this.__table__ });
  }

  // create a virtual/generated column
  generatedAlwaysAs(expression: string): Column<Name, Type, 'virtual'> {
    return this.cloneMeta<'virtual'>({ generatedAlwaysAs: expression, insertType: 'virtual' });
  }

  notNull(): Column<Name, Type, InsertType> {
    return this.cloneMeta({ notNull: true });
  }

  primaryKey(): Column<Name, Type, InsertType> {
    return this.cloneMeta({ primaryKey: true });
  }

  unique(): Column<Name, Type, InsertType> {
    return this.cloneMeta({ unique: true });
  }

  default(value: number | string | null): Column<Name, Type, InsertType> {
    return this.cloneMeta({ default: value });
  }

  references(get: () => Column<any, any, any>): Column<Name, Type, InsertType> {
    const target = get();
    const tableName = target.__table__?.getName();
    if (!tableName) return this.cloneMeta();
    return this.cloneMeta({ foreignKey: `${tableName}.${target.__meta__.name}` });
  }
}
