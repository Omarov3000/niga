import { nanoid } from 'nanoid';
import { s } from '@w/schema';
import type { Schema } from '@w/schema';
import { IndexBuilder, Table } from './table';
import { toSnakeCase } from '../utils/casing';
import { OrmDriver, type ConstraintDefinition, type ConstraintType } from './types';
import { Column } from './column';
import { Db } from './db';
import { syncedDb } from '../sync/synced-db';
import { DerivedTable } from '../sync/derived-table';

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
    decode: (data: number | string | Uint8Array) => {
      // Date columns are stored as integers (timestamps)
      if (typeof data !== 'number') {
        throw new Error(`Date column expects number (timestamp), got ${typeof data}: ${data}`);
      }
      return new Date(data);
    }
  });
};

function json<TSchema extends Schema>(schema: TSchema) {
  const col = new Column<'json', s.infer<TSchema>, 'optional'>({
    kind: 'public',
    name: 'json',
    type: 'text',
    appType: 'json',
    encode: (data: s.infer<TSchema>) => JSON.stringify(data),
    decode: (data: number | string | Uint8Array) => {
      // JSON columns are stored as text (strings)
      if (typeof data !== 'string') {
        throw new Error(`JSON column expects string, got ${typeof data}: ${data}`);
      }
      return JSON.parse(data);
    }
  });
  col.__meta__.jsonSchema = schema as any;
  return col;
}

const boolean = () => {
  return new Column<'boolean', boolean, 'optional'>({
    kind: 'public',
    name: 'boolean',
    type: 'integer',
    appType: 'boolean',
    encode: (bool: boolean) => bool ? 1 : 0,
    decode: (data: number | string | Uint8Array) => {
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
    decode: (data: number | string | Uint8Array) => {
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

const id = () => {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  return new Column<'id', string, 'withDefault'>({
    kind: 'public',
    name: 'id',
    type: 'blob',
    encode: (id: string) => textEncoder.encode(id),
    decode: (data: Uint8Array | number | string) => {
      if (data instanceof Uint8Array) {
        return textDecoder.decode(data);
      }
      throw new Error(`ID column expects Uint8Array, got ${typeof data}: ${data}`);
    }
  }).$defaultFn(() => nanoid()).primaryKey();
};

const idFk = () => {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  return new Column<'idFk', string, 'optional'>({
    kind: 'public',
    name: 'idFk',
    type: 'blob',
    encode: (id: string) => textEncoder.encode(id),
    decode: (data: Uint8Array | number | string) => {
      if (data instanceof Uint8Array) {
        return textDecoder.decode(data);
      }
      throw new Error(`ID foreign key column expects Uint8Array, got ${typeof data}: ${data}`);
    }
  });
};

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

function derivedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[],
  constrainsBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => ConstraintDefinition[]
): DerivedTable<Name, TCols> & TCols {
  // Assign canonical column names on provided columns to match object keys
  Object.entries(columns).forEach(([key, col]) => {
    (col as any).__meta__.name = key as any;
    (col as any).__meta__.dbName = toSnakeCase(key);
  });

  const indexes = (indexesBuilder ? indexesBuilder(columns as any) : []) as any[];
  const normalizedIndexes = indexes.map((idx: any) => idx);
  const constrains = constrainsBuilder ? constrainsBuilder(columns as any) : [];
  const normalizedConstrains = constrains.map((constraint) => [...constraint]) as ConstraintDefinition[];

  const instance = new DerivedTable<Name, TCols>({
    name,
    columns: columns as any,
    indexes: normalizedIndexes,
    constrains: normalizedConstrains,
  }) as any;

  // Don't set derivedFrom here - it will be set when derive() is called
  // Until then, this table is NOT considered derived

  Object.entries(columns).forEach(([key, col]) => {
    instance[key] = col;
  });
  return instance as DerivedTable<Name, TCols> & TCols;
}

const index = () => new IndexBuilder();

function db<TSchema extends Record<string, Table<any, any>>>(opts: { schema: TSchema; name?: string; debugName?: string; origin?: 'client' | 'server'; isProd?: () => boolean; logging?: boolean }): Db & TSchema {
  const instance = new Db({ schema: opts.schema as any, name: opts.name, debugName: opts.debugName, origin: opts.origin, isProd: opts.isProd, logging: opts.logging });
  // Don't overwrite tables - the Db constructor already assigns wrapped tables with proper __db__ context
  return instance as Db & TSchema;
}

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

type ClearRef = { current?: Array<() => Promise<void>> } | undefined;

async function testDb<TSchema extends Record<string, Table<any, any>>>(
  opts: { schema: TSchema; name?: string; debugName?: string; origin?: 'client' | 'server'; isProd?: () => boolean; logging?: boolean },
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

const sText = () => s.string();

const sInteger = () => s.number();

const sReal = () => s.number();

const sDate = () => s.codec(
  s.number(),
  s.date(),
  {
    decode: (timestamp, _payload) => new Date(timestamp),
    encode: (date, _payload) => typeof date === 'string' ? new Date(date).getTime() : date.getTime(),
  }
);

function sJson<TSchema extends Schema>(schema: TSchema) {
  return s.codec(
    s.string(),
    schema,
    {
      decode: (jsonString: string, _payload) => JSON.parse(jsonString),
      encode: (data, _payload) => JSON.stringify(data),
    }
  );
}

const sBoolean = () => s.codec(
  s.number(),
  s.boolean(),
  {
    decode: (num: number, _payload) => num === 1,
    encode: (bool: boolean, _payload) => bool ? 1 : 0,
  }
);

function sEnum<const T extends string>(values: readonly T[], _default: NoInfer<T>) {
  const codec = s.codec(
    s.number(),
    s.enum(values as any),
    {
      decode: (index: number, _payload) => {
        if (index < 0 || index >= values.length) {
          throw new Error(`Enum index ${index} out of range for values: [${values.join(', ')}]`);
        }
        return values[index] as T;
      },
      encode: (enumValue: T, _payload) => values.indexOf(enumValue),
    }
  );
  return s.default(codec, _default);
}

const sId = () => {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  const codec = s.codec(
    s.instanceof(Uint8Array),
    s.string(),
    {
      decode: (blob: Uint8Array, _payload) => textDecoder.decode(blob),
      encode: (id: string, _payload) => new Uint8Array(textEncoder.encode(id)),
    }
  );
  return s.default(codec, () => nanoid());
};

const sIdFk = () => {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  return s.codec(
    s.instanceof(Uint8Array),
    s.string(),
    {
      decode: (blob: Uint8Array, _payload) => textDecoder.decode(blob),
      encode: (id: string, _payload) => new Uint8Array(textEncoder.encode(id)),
    }
  );
};

export const o = {
  text,
  integer,
  real,
  date,
  json,
  boolean,
  enum: enum_,
  id,
  idFk,
  table,
  derivedTable,
  index,
  db,
  testDb,
  syncedDb,
  primaryKey: primaryKeyConstraint,
  unique: uniqueConstraint,
  s: {
    text: sText,
    integer: sInteger,
    real: sReal,
    date: sDate,
    json: sJson,
    boolean: sBoolean,
    enum: sEnum,
    id: sId,
    idFk: sIdFk,
    object: s.object,
  },
};
