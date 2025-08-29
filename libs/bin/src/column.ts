import type { ApplicationType, ColumnType, InsertionType, ColumnMetadata } from './types';

export class Column<
  Name extends string = string,
  Type = unknown,
  InsertType extends InsertionType = 'optional'
> {
  readonly __meta__: ColumnMetadata<Name, ColumnType, ApplicationType, InsertType>;
  __table__?: { getName: () => string };
  private _valueSample?: Type | (() => Type);

  constructor(options: { name: Name; type: ColumnType; appType?: ApplicationType; appDefault?: Type | (() => Type) }) {
    this.__meta__ = {
      name: options.name,
      type: options.type,
      appType: options.appType,
      insertType: 'optional',
      appDefault: options.appDefault,
    } as ColumnMetadata<Name, ColumnType, ApplicationType, InsertType>;
    this._valueSample = options.appDefault;
  }

  $type<T>(): Column<Name, T, InsertType> {
    const c = new Column<Name, T, InsertType>({
      name: this.__meta__.name as Name,
      type: this.__meta__.type,
      appType: this.__meta__.appType,
      appDefault: this.__meta__.appDefault as any,
    });
    c.__table__ = this.__table__;
    Object.assign(c.__meta__, this.__meta__);
    return c;
  }

  private cloneWith(partial: Partial<ColumnMetadata<Name, ColumnType, ApplicationType, InsertType>>): Column<Name, Type, InsertType> {
    const c = new Column<Name, Type, InsertType>({
      name: this.__meta__.name as Name,
      type: this.__meta__.type,
      appType: this.__meta__.appType,
      appDefault: this.__meta__.appDefault as any,
    });
    c.__table__ = this.__table__;
    Object.assign(c.__meta__, this.__meta__, partial);
    return c;
  }

  notNull(): Column<Name, Type, InsertType> {
    return this.cloneWith({ notNull: true });
  }

  primaryKey(): Column<Name, Type, InsertType> {
    return this.cloneWith({ primaryKey: true });
  }

  unique(): Column<Name, Type, InsertType> {
    return this.cloneWith({ unique: true });
  }

  default(value: number | string | null): Column<Name, Type, InsertType> {
    return this.cloneWith({ default: value });
  }

  references(get: () => Column<any, any, any>): Column<Name, Type, InsertType> {
    const target = get();
    const tableName = target.__table__?.getName();
    if (!tableName) {
      return this.cloneWith({});
    }
    return this.cloneWith({ foreignKey: `${tableName}.${target.__meta__.name}` });
  }
}
