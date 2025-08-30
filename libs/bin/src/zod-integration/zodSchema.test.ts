import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Table } from '../table';
import { Column } from '../column';
import { b } from '../builder';

type BinToZodTypeMap = {
  text: z.ZodString;
  integer: z.ZodNumber;
  real: z.ZodNumber;
  blob: z.ZodString;
};

export type TrulyOptional<T> = {
  [P in keyof T as undefined extends T[P] ? never : P]: T[P]
} & {
  [P in keyof T as undefined extends T[P] ? P : never]?: Exclude<T[P], undefined>
};


// Simple direct mapping based on insertion types
type ColumnToZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer Type, infer InsertType> ?
    InsertType extends 'virtual' ? never :
    InsertType extends 'withDefault' ? z.ZodOptional<z.ZodType<Type>> :
    InsertType extends 'optional' ? z.ZodOptional<z.ZodType<Type>> :
    z.ZodType<Type>
  : never;

type TableColumnsToZodSchema<TCols extends Record<string, Column<any, any, any>>> = {
  [K in keyof TCols as ColumnToZodType<TCols[K]> extends never ? never : K]: ColumnToZodType<TCols[K]>
};

type MakeInsertSchema<T extends Table<any, any>> =
  T extends Table<any, infer TCols> ?
    z.ZodObject<TableColumnsToZodSchema<TCols>>
  : never;

type ColumnToSelectZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer Type, infer InsertType> ?
    InsertType extends 'virtual' ? never :
    z.ZodType<Type>
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
  for (const [key, colMeta] of Object.entries(columns)) {
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
  for (const [key, colMeta] of Object.entries(columns)) {
    const col = (binTableSchema as any)[key] as Column<any, any, any>;
    if (!col || col.__meta__.insertType === 'virtual') continue;

    let zodType: z.ZodTypeAny;

    // Handle application types using metadata
    if (col.__meta__.appType) {
      switch (col.__meta__.appType) {
        case 'json':
          if (col.__meta__.jsonSchema) {
            if (col.__meta__.decode) {
              // For select schemas, decode storage format (string) to application format
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
            // For select schemas, decode storage format (timestamp) to Date
            zodType = z.number().transform((timestamp) => col.__meta__.decode!(timestamp));
          } else {
            zodType = z.date();
          }
          break;
        case 'boolean':
          if (col.__meta__.decode) {
            // For select schemas, decode storage format (integer) to boolean
            zodType = z.number().transform((int) => col.__meta__.decode!(int));
          } else {
            zodType = z.boolean();
          }
          break;
        case 'enum':
          if (col.__meta__.enumValues) {
            if (col.__meta__.decode) {
              // For select schemas, decode storage format (index) to enum string
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

    shape[key] = zodType;
  }

  return z.object(shape) as MakeSelectSchema<T>;
}

export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
export type ShallowPrettify<T> = { [K in keyof T]: T[K] } & {}

describe('makeInsertSchema()', () => {
  describe('basic functionality', () => {
    it('creates zod schema for basic column types', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text(),
        age: b.integer(),
        score: b.real(),
      });

      const schema = makeInsertSchema(users);

      expect(schema.parse({
        id: 'test-id',
        name: 'John',
        age: 25,
        score: 95.5,
      })).toMatchObject({
        id: 'test-id',
        name: 'John',
        age: 25,
        score: 95.5,
      });
    });

    it('handles optional vs required columns', () => {
      const users = b.table('users', {
        id: b.id(), // required
        name: b.text().notNull(), // required
        email: b.text(), // optional
        age: b.integer(), // optional
      });

      const schema = makeInsertSchema(users);

      // Should work with only required fields
      expect(schema.parse({
        id: 'test-id',
        name: 'John',
      })).toMatchObject({
        id: 'test-id',
        name: 'John',
      });

      // Should work with all fields
      expect(schema.parse({
        id: 'test-id',
        name: 'John',
        email: 'john@example.com',
        age: 25,
      })).toMatchObject({
        id: 'test-id',
        name: 'John',
        email: 'john@example.com',
        age: 25,
      });
    });
  });

  describe('application types', () => {
    it('handles boolean columns', () => {
      const settings = b.table('settings', {
        id: b.id(),
        enabled: b.boolean().notNull(),
        visible: b.boolean(),
      });

      const schema = makeInsertSchema(settings);

      expect(schema.parse({
        id: 'test-id',
        enabled: true,
        visible: false,
      })).toMatchObject({
        id: 'test-id',
        enabled: true,
        visible: false,
      });
    });

    it('handles boolean columns with codec for integer input', () => {
      const settings = b.table('settings', {
        id: b.id(),
        enabled: b.boolean().notNull(),
      });

      const schema = makeInsertSchema(settings);

      expect(schema.parse({
        id: 'test-id',
        enabled: 1, // integer input should decode to boolean
      })).toMatchObject({
        id: 'test-id',
        enabled: true,
      });

      expect(schema.parse({
        id: 'test-id2',
        enabled: 0, // 0 should decode to false
      })).toMatchObject({
        id: 'test-id2',
        enabled: false,
      });
    });

    it('handles date columns', () => {
      const posts = b.table('posts', {
        id: b.id(),
        createdAt: b.date().notNull(),
        updatedAt: b.date(),
      });

      const schema = makeInsertSchema(posts);
      const now = new Date();

      expect(schema.parse({
        id: 'test-id',
        createdAt: now,
        updatedAt: now,
      })).toMatchObject({
        id: 'test-id',
        createdAt: now,
        updatedAt: now,
      });
    });

    it('handles date columns with codec for timestamp input', () => {
      const posts = b.table('posts', {
        id: b.id(),
        createdAt: b.date().notNull(),
      });

      const schema = makeInsertSchema(posts);
      const timestamp = 1640995200000; // Jan 1, 2022

      expect(schema.parse({
        id: 'test-id',
        createdAt: timestamp,
      })).toMatchObject({
        id: 'test-id',
        createdAt: new Date(timestamp),
      });
    });

    it('handles enum columns with proper values', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user', 'guest'], 'user'),
        status: b.enum(['active', 'inactive'], 'active'),
      });

      const schema = makeInsertSchema(users);

      expect(schema.parse({
        id: 'test-id',
        role: 'admin',
        status: 'active',
      })).toMatchObject({
        id: 'test-id',
        role: 'admin',
        status: 'active',
      });

      // Should reject invalid enum values
      expect(() => schema.parse({
        id: 'test-id',
        role: 'invalid',
        status: 'active',
      })).toThrow();
    });

    it('handles enum columns with codec for integer input', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user', 'guest'], 'user'),
      });

      const schema = makeInsertSchema(users);

      // Test enum index decoding: 0 = 'admin', 1 = 'user', 2 = 'guest'
      expect(schema.parse({
        id: 'test-id',
        role: 0, // index 0 should decode to 'admin'
      })).toMatchObject({
        id: 'test-id',
        role: 'admin',
      });

      expect(schema.parse({
        id: 'test-id2',
        role: 2, // index 2 should decode to 'guest'
      })).toMatchObject({
        id: 'test-id2',
        role: 'guest',
      });
    });

    it('handles json columns with schemas', () => {
      const profileSchema = z.object({
        bio: z.string(),
        age: z.number().optional()
      });

      const users = b.table('users', {
        id: b.id(),
        profile: b.json(profileSchema).notNull(),
        metadata: b.json(z.object({ tags: z.array(z.string()) })),
      });

      const schema = makeInsertSchema(users);

      expect(schema.parse({
        id: 'test-id',
        profile: { bio: 'Developer', age: 30 },
        metadata: { tags: ['tech', 'coding'] },
      })).toMatchObject({
        id: 'test-id',
        profile: { bio: 'Developer', age: 30 },
        metadata: { tags: ['tech', 'coding'] },
      });
    });

    it('handles json columns with codecs for string input', () => {
      const profileSchema = z.object({
        bio: z.string(),
        age: z.number().optional()
      });

      const users = b.table('users', {
        id: b.id(),
        profile: b.json(profileSchema).notNull(),
      });

      const schema = makeInsertSchema(users);

      // Test that codec can decode JSON string input
      expect(schema.parse({
        id: 'test-id',
        profile: '{"bio":"Developer","age":30}',
      })).toMatchObject({
        id: 'test-id',
        profile: { bio: 'Developer', age: 30 },
      });
    });
  });

  describe('constraints and special columns', () => {
    it('excludes virtual/generated columns', () => {
      const users = b.table('users', {
        id: b.id(),
        firstName: b.text(),
        lastName: b.text(),
        fullName: b.text().generatedAlwaysAs('firstName || " " || lastName'),
      });

      const schema = makeInsertSchema(users);
      const shape = schema.shape;

      expect(shape).toHaveProperty('id');
      expect(shape).toHaveProperty('firstName');
      expect(shape).toHaveProperty('lastName');
      expect(shape).not.toHaveProperty('fullName');
    });

    it('handles foreign key references normally', () => {
      const users = b.table('users', { id: b.id() });
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text(),
        authorId: b.text().references(() => users.id),
      });

      const schema = makeInsertSchema(posts);

      expect(schema.parse({
        id: 'post-id',
        title: 'Test Post',
        authorId: 'user-123',
      })).toMatchObject({
        id: 'post-id',
        title: 'Test Post',
        authorId: 'user-123',
      });
    });
  });

  describe('edge cases', () => {
    it('handles empty table schema', () => {
      const empty = b.table('empty', {});
      const schema = makeInsertSchema(empty);

      expect(schema.parse({})).toEqual({});
    });

    it('handles complex mixed scenario', () => {
      const profileSchema = z.object({ bio: z.string() });

      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        email: b.text().unique(),
        age: b.integer(),
        role: b.enum(['admin', 'user'], 'user'),
        isActive: b.boolean(),
        createdAt: b.date().notNull(),
        profile: b.json(profileSchema),
        fullName: b.text().generatedAlwaysAs('name'),
      });

      const schema = makeInsertSchema(users);
      const now = new Date();

      expect(schema.parse({
        id: 'test-id',
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        role: 'admin',
        isActive: true,
        createdAt: now,
        profile: { bio: 'Developer' },
      })).toMatchObject({
        id: 'test-id',
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        role: 'admin',
        isActive: true,
        createdAt: now,
        profile: { bio: 'Developer' },
      });
    });
  });

  describe('error handling', () => {
    it('throws error for enum column without enumValues', () => {
      // Manually create a column with enum appType but no enumValues
      const col = b.text();
      col.__meta__.appType = 'enum';
      // Don't set enumValues

      const table = b.table('test', { role: col });

      expect(() => makeInsertSchema(table)).toThrow("Enum column 'role' must have enumValues in metadata");
    });

    it('throws error for json column without jsonSchema', () => {
      // Manually create a column with json appType but no jsonSchema
      const col = b.text();
      col.__meta__.appType = 'json';
      // Don't set jsonSchema

      const table = b.table('test', { data: col });

      expect(() => makeInsertSchema(table)).toThrow("JSON column 'data' must have jsonSchema in metadata");
    });
  });
});

describe('makeSelectSchema()', () => {
  describe('basic functionality', () => {
    it('creates zod schema for basic column types', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text(),
        age: b.integer(),
        score: b.real(),
      });

      const schema = makeSelectSchema(users);

      expect(schema.parse({
        id: 'test-id',
        name: 'John',
        age: 25,
        score: 95.5,
      })).toMatchObject({
        id: 'test-id',
        name: 'John',
        age: 25,
        score: 95.5,
      });
    });

    it('handles storage format decoding for application types', () => {
      const users = b.table('users', {
        id: b.id(),
        isActive: b.boolean(),
        createdAt: b.date(),
        role: b.enum(['admin', 'user'], 'user'),
      });

      const schema = makeSelectSchema(users);

      // Parse storage format data (from database)
      expect(schema.parse({
        id: 'test-id',
        isActive: 1, // stored as integer in DB
        createdAt: 1640995200000, // stored as timestamp in DB
        role: 0, // stored as index in DB ('admin' = 0)
      })).toMatchObject({
        id: 'test-id',
        isActive: true, // decoded to boolean
        createdAt: new Date(1640995200000), // decoded to Date
        role: 'admin', // decoded to enum string
      });
    });

    it('handles JSON columns with storage format decoding', () => {
      const profileSchema = z.object({
        bio: z.string(),
        age: z.number().optional()
      });

      const users = b.table('users', {
        id: b.id(),
        profile: b.json(profileSchema),
      });

      const schema = makeSelectSchema(users);

      // Parse JSON string from database
      expect(schema.parse({
        id: 'test-id',
        profile: '{"bio":"Developer","age":30}', // stored as JSON string in DB
      })).toMatchObject({
        id: 'test-id',
        profile: { bio: 'Developer', age: 30 }, // decoded to object
      });
    });
  });

  describe('constraints and special columns', () => {
    it('excludes virtual/generated columns', () => {
      const users = b.table('users', {
        id: b.id(),
        firstName: b.text(),
        lastName: b.text(),
        fullName: b.text().generatedAlwaysAs('firstName || " " || lastName'),
      });

      const schema = makeSelectSchema(users);
      const shape = schema.shape;

      expect(shape).toHaveProperty('id');
      expect(shape).toHaveProperty('firstName');
      expect(shape).toHaveProperty('lastName');
      expect(shape).not.toHaveProperty('fullName');
    });

    it('handles foreign key references normally', () => {
      const users = b.table('users', { id: b.id() });
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text(),
        authorId: b.text().references(() => users.id),
      });

      const schema = makeSelectSchema(posts);

      expect(schema.parse({
        id: 'post-id',
        title: 'Test Post',
        authorId: 'user-123',
      })).toMatchObject({
        id: 'post-id',
        title: 'Test Post',
        authorId: 'user-123',
      });
    });
  });

  describe('edge cases', () => {
    it('handles empty table schema', () => {
      const empty = b.table('empty', {});
      const schema = makeSelectSchema(empty);

      expect(schema.parse({})).toEqual({});
    });

    it('handles complex mixed scenario with storage format', () => {
      const profileSchema = z.object({ bio: z.string() });

      const users = b.table('users', {
        id: b.id(),
        name: b.text(),
        email: b.text(),
        age: b.integer(),
        role: b.enum(['admin', 'user'], 'user'),
        isActive: b.boolean(),
        createdAt: b.date(),
        profile: b.json(profileSchema),
        fullName: b.text().generatedAlwaysAs('name'), // should be excluded
      });

      const schema = makeSelectSchema(users);

      // Parse database storage format
      expect(schema.parse({
        id: 'test-id',
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        role: 1, // 'user' stored as index 1
        isActive: 1, // true stored as 1
        createdAt: 1640995200000, // Date stored as timestamp
        profile: '{"bio":"Developer"}', // object stored as JSON string
      })).toMatchObject({
        id: 'test-id',
        name: 'Alice',
        email: 'alice@example.com',
        age: 25,
        role: 'user', // decoded to enum string
        isActive: true, // decoded to boolean
        createdAt: new Date(1640995200000), // decoded to Date
        profile: { bio: 'Developer' }, // decoded to object
      });
    });
  });

  describe('error handling', () => {
    it('throws error for enum column without enumValues', () => {
      // Manually create a column with enum appType but no enumValues
      const col = b.text();
      col.__meta__.appType = 'enum';
      // Don't set enumValues

      const table = b.table('test', { role: col });

      expect(() => makeSelectSchema(table)).toThrow("Enum column 'role' must have enumValues in metadata");
    });

    it('throws error for json column without jsonSchema', () => {
      // Manually create a column with json appType but no jsonSchema
      const col = b.text();
      col.__meta__.appType = 'json';
      // Don't set jsonSchema

      const table = b.table('test', { data: col });

      expect(() => makeSelectSchema(table)).toThrow("JSON column 'data' must have jsonSchema in metadata");
    });

    it('validates input types correctly for date columns', () => {
      const posts = b.table('posts', {
        id: b.id(),
        createdAt: b.date(),
      });

      const schema = makeSelectSchema(posts);

      expect(() => schema.parse({
        id: 'test-id',
        createdAt: 'not-a-timestamp', // string instead of number
      })).toThrow(); // Zod will throw validation error for wrong input type
    });

    it('validates input types correctly for boolean columns', () => {
      const settings = b.table('settings', {
        id: b.id(),
        enabled: b.boolean(),
      });

      const schema = makeSelectSchema(settings);

      expect(() => schema.parse({
        id: 'test-id',
        enabled: 'true', // string instead of number
      })).toThrow(); // Zod will throw validation error for wrong input type
    });

    it('validates input types correctly for json columns', () => {
      const users = b.table('users', {
        id: b.id(),
        profile: b.json(z.object({ bio: z.string() })),
      });

      const schema = makeSelectSchema(users);

      expect(() => schema.parse({
        id: 'test-id',
        profile: 123, // number instead of string
      })).toThrow(); // Zod will throw validation error for wrong input type
    });

    it('validates input types correctly for enum columns', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user'], 'user'),
      });

      const schema = makeSelectSchema(users);

      expect(() => schema.parse({
        id: 'test-id',
        role: 'admin', // string instead of number index
      })).toThrow(); // Zod will throw validation error for wrong input type
    });

    it('throws error when enum index is out of range', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user'], 'user'),
      });

      const schema = makeSelectSchema(users);

      expect(() => schema.parse({
        id: 'test-id',
        role: 5, // index out of range
      })).toThrow('Enum index 5 out of range for values: [admin, user]');
    });

    it('throws error when enum index is negative', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user'], 'user'),
      });

      const schema = makeSelectSchema(users);

      expect(() => schema.parse({
        id: 'test-id',
        role: -1, // negative index
      })).toThrow('Enum index -1 out of range for values: [admin, user]');
    });
  });
});

describe('makeInsertSchema() type tests', () => {
  it('returns correct zod schema type for basic table', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const schema = makeInsertSchema(users);

    // Test that it returns a ZodObject
    type IsZodObject = typeof schema extends z.ZodObject<any> ? true : false;
    type _Test1 = Expect<Equal<IsZodObject, true>>;

    // Test that it can parse the expected data
    const result = schema.parse({
      id: 'test-id',
      name: 'John',
      age: 25,
    });

    // Test the parsed result has correct types
    type ResultType = typeof result;
    type ExpectedResult = {
      id?: string;
      name: string;
      age: number;
    };

    type _Test2 = Expect<Equal<ResultType, ExpectedResult>>;
  });

  it('handles required vs optional columns in schema types', () => {
    const users = b.table('users', {
      id: b.id(), // required
      name: b.text().notNull(), // required
      email: b.text(), // optional
      age: b.integer(), // optional
    });

    const schema = makeInsertSchema(users);

    // Test with only required fields
    const result1 = schema.parse({
      id: 'test-id',
      name: 'John',
    });

    type Result1Type = typeof result1;
    type Expected1 = {
      id?: string;
      name: string;
      email: string;
      age: number;
    };

    type _Test1 = Expect<Equal<Result1Type, Expected1>>;

    // Test with all fields
    const result2 = schema.parse({
      id: 'test-id',
      name: 'John',
      email: 'john@example.com',
      age: 25,
    });

    type Result2Type = typeof result2;
    type _Test2 = Expect<Equal<Result2Type, Expected1>>;
  });

  it('excludes virtual columns from schema type', () => {
    const users = b.table('users', {
      id: b.id(),
      firstName: b.text(),
      fullName: b.text().generatedAlwaysAs('firstName'),
    });

    const schema = makeInsertSchema(users);

    const result = schema.parse({
      id: 'test-id',
      firstName: 'John',
    });

    type ResultType = typeof result;
    type Expected = {
      id?: string;
      firstName: string;
      // fullName should not be present
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles enum types correctly in schema', () => {
    const users = b.table('users', {
      id: b.id(),
      role: b.enum(['admin', 'user'], 'user'),
      status: b.enum(['active', 'inactive'], 'active'),
    });

    const schema = makeInsertSchema(users);

    const result = schema.parse({
      id: 'test-id',
      role: 'admin',
      status: 'active',
    });

    type ResultType = typeof result;
    type Expected = {
      id?: string;
      role: 'admin' | 'user';
      status: 'active' | 'inactive';
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles json types correctly in schema', () => {
    const profileSchema = z.object({ count: z.number() });
    const posts = b.table('posts', {
      id: b.id(),
      metadata: b.json(profileSchema).notNull(),
      tags: b.json(z.array(z.string())),
    });

    const schema = makeInsertSchema(posts);

    const result = schema.parse({
      id: 'test-id',
      metadata: { count: 5 },
      tags: ['test'],
    });

    type ResultType = typeof result;
    type Expected = {
      id?: string;
      metadata: { count: number };
      tags?: string[];
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles boolean and date types correctly in schema', () => {
    const users = b.table('users', {
      id: b.id(),
      isActive: b.boolean().notNull(),
      visible: b.boolean(),
      createdAt: b.date().notNull(),
      updatedAt: b.date(),
    });

    const schema = makeInsertSchema(users);
    const now = new Date();

    const result = schema.parse({
      id: 'test-id',
      isActive: true,
      visible: false,
      createdAt: now,
      updatedAt: now,
    });

    type ResultType = typeof result;
    type Expected = {
      id?: string;
      isActive: boolean;
      visible?: boolean;
      createdAt: Date;
      updatedAt?: Date;
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles complex mixed scenario types', () => {
    const profileSchema = z.object({ bio: z.string() });

    const users = b.table('users', {
      id: b.id(),
      name: b.text().notNull(),
      email: b.text(),
      age: b.integer(),
      role: b.enum(['admin', 'user'], 'user'),
      isActive: b.boolean(),
      createdAt: b.date().notNull(),
      profile: b.json(profileSchema),
      fullName: b.text().generatedAlwaysAs('name'), // should be excluded
    });

    const schema = makeInsertSchema(users);
    const now = new Date();

    const result = schema.parse({
      id: 'test-id',
      name: 'Alice',
      email: 'alice@example.com',
      age: 25,
      role: 'admin',
      isActive: true,
      createdAt: now,
      profile: { bio: 'Developer' },
    });

    type ResultType = typeof result;
    type Expected = {
      id?: string;
      name: string;
      email?: string;
      age?: number;
      role?: 'admin' | 'user';
      isActive?: boolean;
      createdAt: Date;
      profile?: { bio: string };
      // fullName should not be present
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });
});

describe('makeSelectSchema() type tests', () => {
  it('returns correct zod schema type for basic table', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const schema = makeSelectSchema(users);

    // Test that it returns a ZodObject
    type IsZodObject = typeof schema extends z.ZodObject<any> ? true : false;
    type _Test1 = Expect<Equal<IsZodObject, true>>;

    // Test the parsed result has correct types
    const result = schema.parse({
      id: 'test-id',
      name: 'John',
      age: 25,
    });

    type ResultType = typeof result;
    type ExpectedResult = {
      id: string;
      name: string;
      age: number;
    };

    type _Test2 = Expect<Equal<ResultType, ExpectedResult>>;
  });

  it('excludes virtual columns from schema type', () => {
    const users = b.table('users', {
      id: b.id(),
      firstName: b.text(),
      fullName: b.text().generatedAlwaysAs('firstName'),
    });

    const schema = makeSelectSchema(users);

    const result = schema.parse({
      id: 'test-id',
      firstName: 'John',
    });

    type ResultType = typeof result;
    type Expected = {
      id: string;
      firstName: string;
      // fullName should not be present
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles storage format decoding types correctly', () => {
    const users = b.table('users', {
      id: b.id(),
      isActive: b.boolean(),
      createdAt: b.date(),
      role: b.enum(['admin', 'user'], 'user'),
    });

    const schema = makeSelectSchema(users);

    // Parse storage format (what comes from database)
    const result = schema.parse({
      id: 'test-id',
      isActive: 1, // integer from DB
      createdAt: 1640995200000, // timestamp from DB
      role: 0, // index from DB
    });

    type ResultType = typeof result;
    type Expected = {
      id: string;
      isActive: boolean; // decoded to boolean
      createdAt: Date; // decoded to Date
      role: 'admin' | 'user'; // decoded to enum string
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles json types correctly in select schema', () => {
    const profileSchema = z.object({ count: z.number() });
    const posts = b.table('posts', {
      id: b.id(),
      metadata: b.json(profileSchema),
    });

    const schema = makeSelectSchema(posts);

    // Parse JSON string from database
    const result = schema.parse({
      id: 'test-id',
      metadata: '{"count":5}', // JSON string from DB
    });

    type ResultType = typeof result;
    type Expected = {
      id: string;
      metadata: { count: number }; // decoded to object
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });

  it('handles complex mixed scenario types correctly', () => {
    const profileSchema = z.object({ bio: z.string() });

    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      email: b.text(),
      age: b.integer(),
      role: b.enum(['admin', 'user'], 'user'),
      isActive: b.boolean(),
      createdAt: b.date(),
      profile: b.json(profileSchema),
      fullName: b.text().generatedAlwaysAs('name'), // should be excluded
    });

    const schema = makeSelectSchema(users);

    // Parse storage format from database
    const result = schema.parse({
      id: 'test-id',
      name: 'Alice',
      email: 'alice@example.com',
      age: 25,
      role: 1, // index from DB
      isActive: 1, // integer from DB
      createdAt: 1640995200000, // timestamp from DB
      profile: '{"bio":"Developer"}', // JSON string from DB
    });

    type ResultType = typeof result;
    type Expected = {
      id: string;
      name: string;
      email: string;
      age: number;
      role: 'admin' | 'user'; // decoded from index
      isActive: boolean; // decoded from integer
      createdAt: Date; // decoded from timestamp
      profile: { bio: string }; // decoded from JSON string
      // fullName should not be present
    };

    type _Test = Expect<Equal<ResultType, Expected>>;
  });
});
