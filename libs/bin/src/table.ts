import { Column } from './column';
import type { IndexDefinition, TableMetadata, SerializableColumnMetadata } from './types';

type ColumnLike = Column<any, any, any>;

type ColumnsOnly<T> = OmitNever<{ [K in keyof T]: T[K] extends ColumnLike ? T[K] : never }>;

type RawSelectable<T> = {
  [K in keyof T]: T[K] extends Column<any, infer V, infer I>
    ? (I extends 'virtual' ? never : I extends 'required' ? V : V | undefined)
    : never;
};
type RawInsertable<T> = {
  [K in keyof T]: T[K] extends Column<any, infer V, infer I> ? (I extends 'virtual' ? never : V) : never;
};
type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

export type SelectableForCols<T> = OmitNever<RawSelectable<T>>;
export type InsertableForCols<T> = OmitNever<RawInsertable<T>>;

export interface TableConstructorOptions<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
  name: Name;
  columns: TCols;
  indexes?: IndexDefinition[];
}

export class Table<Name extends string, TCols extends Record<string, Column<any, any, any>>> {
  readonly __meta__: TableMetadata;
  // type helpers exposed on instance for precise typing
  readonly __selectionType__!: SelectableForCols<TCols>;
  readonly __insertionType__!: InsertableForCols<TCols>;

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

  make<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf>>(
    this: TSelf,
    overrides: Partial<InsertableForCols<TSelfCols>>
  ): SelectableForCols<TSelfCols> {
    const result: Record<string, unknown> = {};
    const colsMeta = this.__meta__.columns as Record<string, SerializableColumnMetadata>;

    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key] as Column<any, any, any> | undefined;
      if (!col) continue;
      // skip virtual columns
      if (col.__meta__.insertType === 'virtual') continue;

      if (Object.prototype.hasOwnProperty.call(overrides as any, key) && (overrides as any)[key] !== undefined) {
        (result as any)[key] = (overrides as any)[key];
        continue;
      }

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
