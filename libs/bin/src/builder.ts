import { nanoid } from 'nanoid';
import { Column } from './column';
import { Db } from './db';
import { IndexBuilder, Table } from './table';

const text = () => new Column({ name: 'text', type: 'text', appDefault: '' });
const integer = () => new Column({ name: 'integer', type: 'integer', appDefault: 0 });
const real = () => new Column({ name: 'real', type: 'real', appDefault: 0 });
const date = () => new Column({ name: 'date', type: 'integer', appType: 'date', appDefault: new Date() });
const json = () => new Column({ name: 'json', type: 'text', appType: 'json', appDefault: {} });
const boolean = () => new Column({ name: 'boolean', type: 'integer', appType: 'boolean', appDefault: false });

const enum_ = <T extends readonly string[]>(values: T, _default: T[number]) => {
  return new Column({ name: 'enum', type: 'integer', appType: 'enum', appDefault: _default });
};

const id = () => new Column({ name: 'id', type: 'text', appDefault: () => nanoid()  }).primaryKey();

function table<Name extends string, TCols extends Record<string, Column<any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[]
): Table<Name, TCols> & TCols {
  const fixed: Record<string, Column> = {};
  Object.entries(columns).forEach(([key, col]) => {
    const clone = new Column({
      name: key as any,
      type: col.__meta__.type,
      appType: col.__meta__.appType,
    });
    Object.assign(clone.__meta__, col.__meta__, { name: key });
    fixed[key] = clone;
  });

  const indexes = (indexesBuilder ? indexesBuilder(fixed as any) : []) as any[];
  const normalizedIndexes = indexes.map((idx: any) => idx);
  const instance = new Table<Name, any>({ name, columns: fixed, indexes: normalizedIndexes }) as any;
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
