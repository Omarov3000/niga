import type { ZodTypeAny } from 'zod';
import { RawSql } from './utils/sql';
import type { QueryAnalysis } from './security/analyze';

export type ColumnType = 'integer' | 'real' | 'text' | 'blob';

export type ApplicationType = 'json' | 'date' | 'boolean' | 'enum' | 'ulid' | undefined;

export type InsertionType = 'required' | 'optional' | 'virtual' | 'withDefault';

export interface ColumnMetadata {
  name: string;
  dbName: string;
  type: ColumnType;
  insertType: InsertionType;
  notNull?: boolean;
  generatedAlwaysAs?: string;
  primaryKey?: boolean;
  foreignKey?: string;
  unique?: boolean;
  default?: number | string | boolean | null;
  appType?: ApplicationType;
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

export type SerializableColumnMetadata = Pick<ColumnMetadata,
  'name' |
  'dbName' |
  'type' |
  'notNull' |
  'generatedAlwaysAs' |
  'primaryKey' |
  'foreignKey' |
  'unique' |
  'default' |
  'appType' |
  'enumValues'>

export interface IndexDefinition {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface SerializableTableMetadata {
  name: string;
  dbName: string;
  columns: Record<string, SerializableColumnMetadata>;
  indexes?: IndexDefinition[];
  constrains?: string[][];
}

export interface TableMetadata {
  name: string;
  dbName: string;
  columns: Record<string, ColumnMetadata>;
  indexes?: IndexDefinition[];
  constrains?: string[][];
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

export interface QueryContext<TData extends Record<string, unknown> = Record<string, unknown>> {
  type: QueryType;
  accessedTables: string[];
  data?: TData; // The data being inserted or updated
  analysis: QueryAnalysis;
}

export type SecurityRule<TUser = any, TData extends Record<string, unknown> = Record<string, unknown>> = (query: QueryContext<TData>, user: TUser) => boolean | void | Promise<boolean | void>;

export interface ImmutableFieldRule {
  tableName: string;
  fieldName: string;
}
