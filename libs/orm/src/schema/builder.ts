import { nanoid } from 'nanoid';
import { z, type ZodTypeAny, infer as zInfer } from 'zod';
import { IndexBuilder, Table } from './table';
import { getDefaultValueFromZodSchema } from '../zod-integration/get-default-value-from-zod-schema';
import { toSnakeCase } from '../utils/casing';
import { OrmDriver, type ConstraintDefinition, type ConstraintType } from './types';
import { Column } from './column';
import { Db } from './db';

const text = () => new Column<'text', string, 'optional'>({ kind: 'public', name: 'text', type: 'text' });
const integer = () => new Column<'integer', number, 'optional'>({ kind: 'public', name: 'integer', type: 'integer' });
const real = () => new Column<'real', number, 'optional'>({ kind: 'public', name: 'real', type: 'real' });
const date = () => {
  return new Column<'date', Date, 'optional'>({
    kind: 'public',
    name: 'date',
    type: 'integer',
    appType: 'date',
    encode: (date: Date) => date.getTime(),
    decode: (data: number | string) => {
      // Date columns are stored as integers (timestamps)
      if (typeof data !== 'number') {
        throw new Error(`Date column expects number (timestamp), got ${typeof data}: ${data}`);
      }
      return new Date(data);
    }
  });
};

function json<TSchema extends ZodTypeAny>(schema: TSchema) {
  const col = new Column<'json', zInfer<TSchema>, 'optional'>({
    kind: 'public',
    name: 'json',
    type: 'text',
    appType: 'json',
    encode: (data: zInfer<TSchema>) => JSON.stringify(data),
    decode: (data: number | string) => {
      // JSON columns are stored as text (strings)
      if (typeof data !== 'string') {
        throw new Error(`JSON column expects string, got ${typeof data}: ${data}`);
      }
      return JSON.parse(data);
    }
  });
  col.__meta__.jsonSchema = schema;
  return col;
}

const boolean = () => {
  return new Column<'boolean', boolean, 'optional'>({
    kind: 'public',
    name: 'boolean',
    type: 'integer',
    appType: 'boolean',
    encode: (bool: boolean) => bool ? 1 : 0,
    decode: (data: number | string) => {
      // Boolean columns are stored as integers (0 or 1)
      if (typeof data !== 'number') {
        throw new Error(`Boolean column expects number (0 or 1), got ${typeof data}: ${data}`);
      }
      return data === 1;
    }
  });
};

function enum_<const T extends string>(values: readonly T[]) {
  const col = new Column<'enum', T, 'optional'>({
    kind: 'public',
    name: 'enum',
    type: 'integer',
    appType: 'enum',
    encode: (enumValue: T) => values.indexOf(enumValue),
    decode: (data: number | string) => {
      // Enum columns are stored as integers (indexes)
      if (typeof data !== 'number') {
        throw new Error(`Enum column expects number (index), got ${typeof data}: ${data}`);
      }
      if (data < 0 || data >= values.length) {
        throw new Error(`Enum index ${data} out of range for values: [${values.join(', ')}]`);
      }
      return values[data] as T;
    }
  });
  col.__meta__.enumValues = values;
  return col;
}

const id = () => new Column<'id', string, 'withDefault'>({ kind: 'public', name: 'id', type: 'text' }).$defaultFn(() => nanoid()).primaryKey();

const ensureConstraintColumns = (type: ConstraintType, columns: Column[]): ConstraintDefinition => {
  if (columns.length === 0) {
    throw new Error(`${type} constraint requires at least one column`);
  }

  const columnNames = columns.map((column) => {
    const dbName = column.__meta__.dbName ?? toSnakeCase(column.__meta__.name ?? '');
    if (!dbName) {
      throw new Error('Constraint column is missing dbName');
    }
    return dbName;
  });

  const uniqueNames = new Set(columnNames);
  if (uniqueNames.size !== columnNames.length) {
    throw new Error(`${type} constraint columns must be unique`);
  }

  return [type, ...columnNames];
};

const primaryKeyConstraint = (...columns: Column[]): ConstraintDefinition => ensureConstraintColumns('primaryKey', columns);

const uniqueConstraint = (...columns: Column[]): ConstraintDefinition => ensureConstraintColumns('unique', columns);

function table<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[],
  constrainsBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => ConstraintDefinition[]
): Table<Name, TCols> & TCols {
  // Assign canonical column names on provided columns to match object keys
  Object.entries(columns).forEach(([key, col]) => {
    (col as any).__meta__.name = key as any;
    (col as any).__meta__.dbName = toSnakeCase(key);
  });

  const indexes = (indexesBuilder ? indexesBuilder(columns as any) : []) as any[];
  const normalizedIndexes = indexes.map((idx: any) => idx);
  const constrains = constrainsBuilder ? constrainsBuilder(columns as any) : [];
  const normalizedConstrains = constrains.map((constraint) => [...constraint]) as ConstraintDefinition[];
  const instance = new Table<Name, TCols>({
    name,
    columns: columns as any,
    indexes: normalizedIndexes,
    constrains: normalizedConstrains,
  }) as any;
  Object.entries(columns).forEach(([key, col]) => {
    instance[key] = col;
  });
  return instance as Table<Name, TCols> & TCols;
}

const index = () => new IndexBuilder();

function db<TSchema extends Record<string, Table<any, any>>>(opts: { schema: TSchema; name?: string; origin?: 'client' | 'server' }): Db & TSchema {
  const instance = new Db({ schema: opts.schema as any, name: opts.name, origin: opts.origin });
  Object.entries(opts.schema).forEach(([key, table]) => {
    (instance as any)[key] = table;
  });
  return instance as Db & TSchema;
}

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

type ClearRef = { current?: Array<() => Promise<void>> } | undefined;

async function testDb<TSchema extends Record<string, Table<any, any>>>(
  opts: { schema: TSchema; name?: string; origin?: 'client' | 'server' },
  driver: OrmDriver,
  clearRef?: ClearRef
): Promise<Db & TSchema> {
  const tableNames = Object.values(opts.schema).map((table) => table.__meta__.dbName);
  if (tableNames.length > 0) {
    const dropStatements = [
      'PRAGMA foreign_keys = OFF',
      ...tableNames.map((name) => `DROP TABLE IF EXISTS ${quoteIdentifier(name)}`),
      'PRAGMA foreign_keys = ON',
    ].join('; ');
    await driver.exec(dropStatements);
  }

  const instance = db(opts)
  await instance._connectDriver(driver);
  await driver.exec(instance.getSchemaDefinition());
  if (clearRef) {
    const queue = clearRef.current ?? [];
    queue.push(async () => {
      await instance._clear();
    });
    clearRef.current = queue;
  }
  return instance as Db & TSchema;
}

const zText = () => z.string();

const zInteger = () => z.number().int();

const zReal = () => z.number();

const zDate = () => z.codec(
  z.number(),
  z.date(),
  {
    decode: (timestamp: number) => new Date(timestamp),
    encode: (date: Date) => date.getTime(),
  }
);

function zJson<TSchema extends ZodTypeAny>(schema: TSchema) {
  return z.codec(
    z.string(),
    schema,
    {
      decode: (jsonString: string) => JSON.parse(jsonString),
      encode: (data) => JSON.stringify(data),
    }
  );
}

const zBoolean = () => z.codec(
  z.number(),
  z.boolean(),
  {
    decode: (num: number) => num === 1,
    encode: (bool: boolean) => bool ? 1 : 0,
  }
);

function zEnum<const T extends string>(values: readonly T[], _default: NoInfer<T>) {
  return z.codec(
    z.number(),
    z.enum(values as any),
    {
      decode: (index: number) => {
        if (index < 0 || index >= values.length) {
          throw new Error(`Enum index ${index} out of range for values: [${values.join(', ')}]`);
        }
        return values[index] as T;
      },
      encode: (enumValue: T) => values.indexOf(enumValue),
    }
  );
}

const zId = () => z.string().default(() => nanoid());

export const o = {
  text,
  integer,
  real,
  date,
  json,
  boolean,
  enum: enum_,
  id,
  table,
  index,
  db,
  testDb,
  primaryKey: primaryKeyConstraint,
  unique: uniqueConstraint,
  z: {
    text: zText,
    integer: zInteger,
    real: zReal,
    date: zDate,
    json: zJson,
    boolean: zBoolean,
    enum: zEnum,
    id: zId,
    object: z.object,
  },
};
