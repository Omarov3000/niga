import { nanoid } from 'nanoid';
import type { ZodTypeAny, infer as zInfer } from 'zod';
import { Column } from './column';
import { Db } from './db';
import { IndexBuilder, Table } from './table';
import { getDefaultValueFromZodSchema } from './zod-integration/getDefaultValueFromZodSchema';

const text = () => new Column({ kind: 'public', name: 'text', type: 'text', appDefault: '' });
const integer = () => new Column({ kind: 'public', name: 'integer', type: 'integer', appDefault: 0 });
const real = () => new Column({ kind: 'public', name: 'real', type: 'real', appDefault: 0 });
const date = () => new Column({ kind: 'public', name: 'date', type: 'integer', appType: 'date', appDefault: new Date() });

function json<TSchema extends ZodTypeAny>(schema: TSchema) {
  const col = new Column<'json', zInfer<TSchema>>({ kind: 'public', name: 'json', type: 'text', appType: 'json', appDefault: getDefaultValueFromZodSchema(schema) });
  col.__meta__.jsonSchema = schema;
  return col;
}

const boolean = () => new Column({ kind: 'public', name: 'boolean', type: 'integer', appType: 'boolean', appDefault: false });

function enum_<const T extends string>(values: readonly T[], _default: NoInfer<T>) {
  return new Column<'enum', T, 'required'>({ kind: 'public', name: 'enum', type: 'integer', appType: 'enum', appDefault: _default });
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

function db(opts: { schema: Record<string, Table<any, any>> }) {
  return new Db({ schema: opts.schema as any });
}

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
};
