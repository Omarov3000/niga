import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Table } from '../table';
import { Column } from '../column';
import { b } from '../builder';
import { Equal, Expect } from '../utils';

type ColumnBaseZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<infer Name, infer Type, any>
    ? Name extends 'text' | 'blob' | 'id' ? z.ZodString
      : Name extends 'integer' | 'real' ? z.ZodNumber
      : Name extends 'date' ? z.ZodDate
      : Name extends 'boolean' ? z.ZodBoolean
      : z.ZodType<Type>
    : never;

type ColumnToZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer _Type, infer InsertType> ?
    InsertType extends 'virtual' ? never :
    InsertType extends 'withDefault' ? z.ZodOptional<ColumnBaseZodType<TCol>> :
    InsertType extends 'optional' ? z.ZodOptional<ColumnBaseZodType<TCol>> :
    ColumnBaseZodType<TCol>
  : never;


type TableColumnsToZodSchema<TCols extends Record<string, Column<any, any, any>>> = {
  [K in keyof TCols as ColumnToZodType<TCols[K]> extends never ? never : K]: ColumnToZodType<TCols[K]>
};

type MakeInsertSchema<T extends Table<any, any>> =
  T extends Table<any, infer TCols> ?
    z.ZodObject<TableColumnsToZodSchema<TCols>>
  : never;

type ColumnToSelectZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer _Type, infer InsertType> ?
    InsertType extends 'virtual' ? never :
    InsertType extends 'optional' ? z.ZodOptional<ColumnBaseZodType<TCol>> :
    ColumnBaseZodType<TCol>
  : never;

type TableColumnsToSelectZodSchema<TCols extends Record<string, Column<any, any, any>>> = {
  [K in keyof TCols as ColumnToSelectZodType<TCols[K]> extends never ? never : K]: ColumnToSelectZodType<TCols[K]>
};

type MakeSelectSchema<T extends Table<any, any>> =
  T extends Table<any, infer TCols> ?
    z.ZodObject<TableColumnsToSelectZodSchema<TCols>>
  : never;

export function makeInsertSchema<T extends Table<any, any>>(binTableSchema: T): MakeInsertSchema<T> {
  const shape: Record<string, z.ZodTypeAny> = {};

  const columns = binTableSchema.__meta__.columns;
  for (const [key] of Object.entries(columns)) {
    const col = (binTableSchema as any)[key] as Column<any, any, any>;
    if (!col || col.__meta__.insertType === 'virtual') continue;

    let zodType: z.ZodTypeAny;

    // Handle application types using metadata
    if (col.__meta__.appType) {
      switch (col.__meta__.appType) {
        case 'json':
          if (col.__meta__.jsonSchema) {
            if (col.__meta__.encode && col.__meta__.decode) {
              // For insert schemas, accept both object and string formats
              zodType = z.union([
                col.__meta__.jsonSchema, // accept object directly
                z.string().transform((str) => col.__meta__.decode!(str)) // accept JSON string and decode
              ]);
            } else {
              zodType = col.__meta__.jsonSchema;
            }
          } else {
            throw new Error(`JSON column '${key}' must have jsonSchema in metadata`);
          }
          break;
        case 'date':
          if (col.__meta__.encode && col.__meta__.decode) {
            // For insert schemas, accept both Date and timestamp formats
            zodType = z.union([
              z.date(), // accept Date object directly
              z.number().transform((timestamp) => col.__meta__.decode!(timestamp)) // accept timestamp and decode
            ]);
          } else {
            zodType = z.date();
          }
          break;
        case 'boolean':
          if (col.__meta__.encode && col.__meta__.decode) {
            // For insert schemas, accept both boolean and integer formats
            zodType = z.union([
              z.boolean(), // accept boolean directly
              z.number().transform((int) => col.__meta__.decode!(int)) // accept integer and decode
            ]);
          } else {
            zodType = z.boolean();
          }
          break;
        case 'enum':
          if (col.__meta__.enumValues) {
            if (col.__meta__.encode && col.__meta__.decode) {
              // For insert schemas, accept both string and index formats
              zodType = z.union([
                z.enum(col.__meta__.enumValues as [string, ...string[]]), // accept enum string directly
                z.number().transform((index) => col.__meta__.decode!(index)) // accept index and decode
              ]);
            } else {
              zodType = z.enum(col.__meta__.enumValues as [string, ...string[]]);
            }
          } else {
            throw new Error(`Enum column '${key}' must have enumValues in metadata`);
          }
          break;
        case 'ulid':
          zodType = z.string();
          break;
        default:
          throw new Error(`Unsupported appType '${col.__meta__.appType}' for column '${key}'`);
      }
    } else {
      // Handle basic column types
      switch (col.__meta__.type) {
        case 'text':
          zodType = z.string();
          break;
        case 'integer':
        case 'real':
          zodType = z.number();
          break;
        case 'blob':
          zodType = z.string();
          break;
        default:
          throw new Error(`Unsupported column type '${col.__meta__.type}' for column '${key}'`);
      }
    }

    // Make optional if has app default OR insertion type indicates optional
    if (col.__meta__.appDefault !== undefined || col.__meta__.insertType === 'withDefault' || col.__meta__.insertType === 'optional') {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape) as MakeInsertSchema<T>;
}

export function makeSelectSchema<T extends Table<any, any>>(binTableSchema: T): MakeSelectSchema<T> {
  const shape: Record<string, z.ZodTypeAny> = {};

  const columns = binTableSchema.__meta__.columns;
  for (const [key] of Object.entries(columns)) {
    const col = (binTableSchema as any)[key] as Column<any, any, any>;
    if (!col || col.__meta__.insertType === 'virtual') continue;

    let zodType: z.ZodTypeAny;

    if (col.__meta__.appType) {
      switch (col.__meta__.appType) {
        case 'json':
          if (col.__meta__.jsonSchema) {
            if (col.__meta__.decode) {
              zodType = z.string().transform((str) => col.__meta__.decode!(str));
            } else {
              zodType = col.__meta__.jsonSchema;
            }
          } else {
            throw new Error(`JSON column '${key}' must have jsonSchema in metadata`);
          }
          break;
        case 'date':
          if (col.__meta__.decode) {
            zodType = z.number().transform((timestamp) => col.__meta__.decode!(timestamp));
          } else {
            zodType = z.date();
          }
          break;
        case 'boolean':
          if (col.__meta__.decode) {
            zodType = z.number().transform((int) => col.__meta__.decode!(int));
          } else {
            zodType = z.boolean();
          }
          break;
        case 'enum':
          if (col.__meta__.enumValues) {
            if (col.__meta__.decode) {
              zodType = z.number().transform((index) => col.__meta__.decode!(index));
            } else {
              zodType = z.enum(col.__meta__.enumValues as [string, ...string[]]);
            }
          } else {
            throw new Error(`Enum column '${key}' must have enumValues in metadata`);
          }
          break;
        case 'ulid':
          zodType = z.string();
          break;
        default:
          throw new Error(`Unsupported appType '${col.__meta__.appType}' for column '${key}'`);
      }
    } else {
      switch (col.__meta__.type) {
        case 'text':
          zodType = z.string();
          break;
        case 'integer':
        case 'real':
          zodType = z.number();
          break;
        case 'blob':
          zodType = z.string();
          break;
        default:
          throw new Error(`Unsupported column type '${col.__meta__.type}' for column '${key}'`);
      }
    }

    if (col.__meta__.insertType === 'optional') {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape) as MakeSelectSchema<T>;
}
