import type { ZodTypeAny } from 'zod';
import { SelectSql } from './utils/sql';

export type ColumnType = 'integer' | 'real' | 'text' | 'blob';

export type ApplicationType = 'json' | 'date' | 'boolean' | 'enum' | 'ulid' | undefined;

export type InsertionType = 'required' | 'optional' | 'virtual';

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
  exec: (sql: string) => any;
  run: (sql: SelectSql) => any;
}
