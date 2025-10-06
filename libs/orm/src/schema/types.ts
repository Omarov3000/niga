import type { Schema } from '@w/schema';
import { RawSql } from '../utils/sql';
import type { QueryAnalysis } from '../true-sql/analyze';

export type ColumnType = 'integer' | 'real' | 'text' | 'blob';

export type ApplicationType = 'json' | 'date' | 'boolean' | 'enum' | 'ulid' | undefined;

export type InsertionType = 'required' | 'optional' | 'virtual' | 'withDefault';

export type ConstraintType = 'primaryKey' | 'unique';

export type ConstraintDefinition = [ConstraintType, ...string[]];

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
  serverTime?: boolean; // TODO: how?
  appDefault?: (() => unknown) | unknown;
  appOnUpdate?: (() => unknown) | unknown;
  encode?: (data: unknown) => number | string | Uint8Array;
  decode?: (data: number | string | Uint8Array) => unknown;
  aliasedFrom?: string;
  definition?: string // eg COUNT(*) for virtual columns
  jsonSchema?: Schema;
  enumValues?: readonly string[];
  renamedFrom?: string;
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
  'enumValues' |
  'renamedFrom'>

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
  constrains?: ConstraintDefinition[];
  renamedFrom?: string;
}

export type TableSnapshot = SerializableTableMetadata;

export interface PreparedSnapshot {
  snapshot: TableSnapshot[];
  migration: {
    name: string;
    sql: string;
  };
  hasChanges: boolean;
}

export interface TableMetadata {
  name: string;
  dbName: string;
  columns: Record<string, ColumnMetadata>;
  indexes?: IndexDefinition[];
  constrains?: ConstraintDefinition[];
  aliasedFrom?: string;
  renamedFrom?: string;
}

export interface OrmDriver {
  logging: boolean;
  debugName: string;
  exec: (sql: string) => Promise<any>;
  run: (sql: RawSql) => Promise<any>;
  beginTransaction: () => Promise<TxDriver>;
  batch: (statements: RawSql[]) => Promise<any[]>;
}

export const fakeOrmDriver: OrmDriver = {
  logging: false,
  debugName: '',
  exec: async () => { throw new Error('not implemented') },
  run: async () => { throw new Error('not implemented') },
  beginTransaction: async () => { throw new Error('not implemented') },
  batch: async () => { throw new Error('not implemented') },
}

export interface TxDriver {
  run: (sql: RawSql) => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
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

export class ColumnMutationNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnMutationNotSupportedError';
  }
}
