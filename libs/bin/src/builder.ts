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

const enum_ = <T extends readonly string[]>(values: T, _default: T[number]) => {
  return new Column({ kind: 'public', name: 'enum', type: 'integer', appType: 'enum', appDefault: _default });
};

const id = () => new Column({ kind: 'public', name: 'id', type: 'text', appDefault: () => nanoid() }).primaryKey();

function table<Name extends string, TCols extends Record<string, Column<any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[]
): Table<Name, TCols> & TCols {
  const fixed: Record<string, Column> = {};
  Object.entries(columns).forEach(([key, col]) => {
    const clone = new Column({
      kind: 'public',
      name: key as any,
      type: col.__meta__.type,
      appType: col.__meta__.appType,
    });
    Object.assign(clone.__meta__, col.__meta__, { name: key });
    fixed[key] = clone;
  });

  const indexes = (indexesBuilder ? indexesBuilder(fixed as any) : []) as any[];
  const normalizedIndexes = indexes.map((idx: any) => idx);
  const instance = new Table<Name, any>({ name, columns: fixed as any, indexes: normalizedIndexes }) as any;
  Object.entries(fixed).forEach(([key, col]) => {
    instance[key] = col;
  });
  return instance as Table<Name, any> & TCols;
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
