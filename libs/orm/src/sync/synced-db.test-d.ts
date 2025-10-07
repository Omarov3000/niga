import { describe, expectTypeOf, it } from 'vitest';
import { o } from '../schema/builder';
import { ShallowPrettify } from '../utils/utils';
import { _makeClientDb, _makeRemoteDb } from './test-helpers';

describe('insertWithUndo', () => {
  it('validates insertWithUndo data types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const { remoteDb } = await _makeRemoteDb({ users });
    const { db } = await _makeClientDb({ users }, remoteDb, { skipPull: true });

    const result = await db.users.insertWithUndo({ id: 'user-1', name: 'Alice', age: 30 });

    type _Received = ShallowPrettify<typeof result>;
    type Expected = { id: string; name: string; age: number };
    expectTypeOf(result).toEqualTypeOf<Expected>();

    // @ts-expect-error - age should be number, not string
    await db.users.insertWithUndo({ id: 'user-2', name: 'Bob', age: '25' });

    // @ts-expect-error - missing required field 'age'
    await db.users.insertWithUndo({ id: 'user-3', name: 'Charlie' });
  });
});

describe('updateWithUndo', () => {
  it('validates updateWithUndo data types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const { remoteDb } = await _makeRemoteDb({ users });
    const { db } = await _makeClientDb({ users }, remoteDb, { skipPull: true });

    await db.users.updateWithUndo({
      data: { name: 'Alice Updated', age: 31 },
      where: { id: 'user-1' },
    });

    await db.users.updateWithUndo({
      // @ts-expect-error - age should be number, not string
      data: { age: '32' },
      where: { id: 'user-1' },
    });

    await db.users.updateWithUndo({
      // @ts-expect-error - invalid field 'email'
      data: { email: 'test@example.com' },
      where: { id: 'user-1' },
    });
  });
});

describe('deleteWithUndo', () => {
  it('validates deleteWithUndo where clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const { remoteDb } = await _makeRemoteDb({ users });
    const { db } = await _makeClientDb({ users }, remoteDb, { skipPull: true });

    await db.users.deleteWithUndo({
      where: { id: 'user-1' },
    });

    await db.users.deleteWithUndo({
      // @ts-expect-error - where must have id field
      where: { name: 'Alice' },
    });
  });
});
