import type { ZodTypeAny } from 'zod';
import { RawSql } from './utils/sql';

export type ColumnType = 'integer' | 'real' | 'text' | 'blob';

export type ApplicationType = 'json' | 'date' | 'boolean' | 'enum' | 'ulid' | undefined;

export type InsertionType = 'required' | 'optional' | 'virtual' | 'withDefault';

export interface SerializableColumnMetadata {
  name: string;
  type: ColumnType;
  notNull?: boolean;
  generatedAlwaysAs?: string;
  primaryKey?: boolean;
  foreignKey?: string;
  unique?: boolean;
  default?: number | string | boolean | null;
  appType?: ApplicationType;
}

export interface ColumnMetadata extends SerializableColumnMetadata {
  insertType: InsertionType;
  serverTime?: boolean;
  appDefault?: (() => unknown) | unknown;
  appOnUpdate?: (() => unknown) | unknown;
  encode?: (data: unknown) => number | string;
  decode?: (data: number | string) => unknown;
  aliasedFrom?: string;
  definition?: string;
  jsonSchema?: ZodTypeAny;
  enumValues?: readonly string[];
}

export interface IndexDefinition {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface SerializableTableMetadata {
  name: string;
  columns: Record<string, SerializableColumnMetadata>;
  indexes?: IndexDefinition[];
  constrains?: string[][];
}

export interface TableMetadata extends SerializableTableMetadata {
  aliasedFrom?: string;
}

export interface BinDriver {
  exec: (sql: string) => Promise<any>;
  run: (sql: RawSql) => Promise<any>;
}

export interface SecurityCheckContext {
  tableName: string;
  columnName: string;
  value: any;
  operator: string;
}

export type QueryType = 'select' | 'insert' | 'update' | 'delete';

export interface QueryContext {
  type: QueryType;
  accessedTables: string[];
  data?: any; // The data being inserted or updated
}

export type SecurityRule<TUser = any> = (query: QueryContext, user: TUser) => boolean | Promise<boolean>;

export interface ImmutableFieldRule {
  tableName: string;
  fieldName: string;
}
