import { nanoid } from 'nanoid';
import { z, type ZodTypeAny, infer as zInfer } from 'zod';
import { Column } from './column';
import { Db } from './db';
import { IndexBuilder, Table } from './table';
import { getDefaultValueFromZodSchema } from './zod-integration/getDefaultValueFromZodSchema';

const text = () => new Column({ kind: 'public', name: 'text', type: 'text', appDefault: '' });
const integer = () => new Column({ kind: 'public', name: 'integer', type: 'integer', appDefault: 0 });
const real = () => new Column({ kind: 'public', name: 'real', type: 'real', appDefault: 0 });
const date = () => {
  return new Column({
    kind: 'public',
    name: 'date',
    type: 'integer',
    appType: 'date',
    appDefault: new Date(),
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
  const col = new Column<'json', zInfer<TSchema>>({
    kind: 'public',
    name: 'json',
    type: 'text',
    appType: 'json',
    appDefault: getDefaultValueFromZodSchema(schema),
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
  return new Column({
    kind: 'public',
    name: 'boolean',
    type: 'integer',
    appType: 'boolean',
    appDefault: false,
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

function enum_<const T extends string>(values: readonly T[], _default: NoInfer<T>) {
  const col = new Column<'enum', T, 'required'>({
    kind: 'public',
    name: 'enum',
    type: 'integer',
    appType: 'enum',
    appDefault: _default,
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

const id = () => new Column<'id', string, 'required'>({ kind: 'public', name: 'id', type: 'text', appDefault: () => nanoid() }).primaryKey();

function table<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[]
): Table<Name, TCols> & TCols {
  // Assign canonical column names on provided columns to match object keys
  Object.entries(columns).forEach(([key, col]) => {
    (col as any).__meta__.name = key as any;
  });

  const indexes = (indexesBuilder ? indexesBuilder(columns as any) : []) as any[];
  const normalizedIndexes = indexes.map((idx: any) => idx);
  const instance = new Table<Name, TCols>({ name, columns: columns as any, indexes: normalizedIndexes }) as any;
  Object.entries(columns).forEach(([key, col]) => {
    instance[key] = col;
  });
  return instance as Table<Name, TCols> & TCols;
}

const index = () => new IndexBuilder();

function db<TSchema extends Record<string, Table<any, any>>>(opts: { schema: TSchema }): Db & TSchema {
  const instance = new Db({ schema: opts.schema as any });
  Object.entries(opts.schema).forEach(([key, table]) => {
    (instance as any)[key] = table;
  });
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

export const b = {
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
