import { Column } from './column';
import type { IndexDefinition, TableMetadata, SerializableColumnMetadata } from './types';

export interface TableConstructorOptions<Name extends string, TCols extends Record<string, Column<any, any>>> {
  name: Name;
  columns: TCols;
  indexes?: IndexDefinition[];
}

export class Table<Name extends string, TCols extends Record<string, Column<any, any>>> {
  readonly __meta__: TableMetadata;

  constructor(options: TableConstructorOptions<Name, TCols>) {
    const columnMetadata: Record<string, any> = {};
    Object.entries(options.columns).forEach(([key, col]) => {
      col.__table__ = { getName: () => options.name };
      (this as any)[key] = col;
      columnMetadata[key] = { ...col.__meta__, name: key } as SerializableColumnMetadata;
    });

    this.__meta__ = {
      name: options.name,
      columns: columnMetadata as Record<string, SerializableColumnMetadata>,
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
