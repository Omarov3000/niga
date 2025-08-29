export type ColumnType = 'integer' | 'real' | 'text' | 'blob';

export type ApplicationType = 'json' | 'date' | 'boolean' | 'enum' | 'ulid' | undefined;

export type InsertionType = 'required' | 'optional' | 'virtual';

export interface SerializableColumnMetadata<
  Name extends string,
  Type extends ColumnType,
  AppType extends ApplicationType
> {
  name: Name;
  type: Type;
  notNull?: boolean;
  generatedAlwaysAs?: string;
  primaryKey?: boolean;
  foreignKey?: string;
  unique?: boolean;
  default?: number | string | null;
  appType?: AppType;
}

export interface ColumnMetadata<
  Name extends string,
  Type extends ColumnType,
  AppType extends ApplicationType,
  InsertType extends InsertionType
> extends SerializableColumnMetadata<Name, Type, AppType> {
  insertType: InsertType;
  serverTime?: boolean;
  appDefault?: (() => any) | any;
  encode?: (data: any) => number | string;
  decode?: (data: number | string) => any;
  aliasedFrom?: string;
  definition?: string;
}

export interface IndexDefinition {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface TableMetadata<
  Name extends string = string,
  Columns extends Record<string, SerializableColumnMetadata<any, any, any>> = Record<string, SerializableColumnMetadata<any, any, any>>
> {
  name: Name;
  columns: Columns;
  indexes: IndexDefinition[];
  constrains?: string[][];
}
