import { Column } from './column';
import type { IndexDefinition, TableMetadata, SerializableColumnMetadata } from './types';

export interface TableConstructorOptions<Name extends string, TCols extends Record<string, Column<any, any>>> {
  name: Name;
  columns: TCols;
  indexes?: IndexDefinition[];
}

type ColumnsMeta<TCols extends Record<string, Column<any, any>>> = {
  [K in keyof TCols & string]: SerializableColumnMetadata<K, TCols[K]['__meta__']['type'], TCols[K]['__meta__']['appType']>;
};

export class Table<Name extends string, TCols extends Record<string, Column<any, any>>> {
  readonly __meta__: TableMetadata<Name, ColumnsMeta<TCols>>;

  constructor(options: TableConstructorOptions<Name, TCols>) {
    const columnMetadata: Record<string, any> = {};
    Object.entries(options.columns).forEach(([key, col]) => {
      col.__table__ = { getName: () => options.name };
      (this as any)[key] = col;
      columnMetadata[key] = { ...col.__meta__, name: key } as SerializableColumnMetadata<any, any, any>;
    });

    this.__meta__ = {
      name: options.name,
      columns: columnMetadata as ColumnsMeta<TCols>,
      indexes: options.indexes ?? [],
    } as TableMetadata<Name, ColumnsMeta<TCols>>;
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
