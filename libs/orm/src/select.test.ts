import { afterEach, expect, expectTypeOf, it } from 'vitest';
import { OrmNodeDriver } from './orm-node-driver';
import { o } from './schema/builder';
import { ShallowPrettify } from './utils/utils';

const driver = new OrmNodeDriver();
const clearRef: { current?: Array<() => Promise<void>> } = { current: [] };

afterEach(async () => {
  const clearFns = [...(clearRef.current ?? [])];
  clearRef.current = [];

  for (const fn of clearFns.reverse()) {
    await fn();
  }
});

it('selects with nested joins', async () => {
  const users = o.table('users', {
    id: o.id(),
    name: o.text().notNull(),
  });

  const pets = o.table('pets', {
    id: o.id(),
    name: o.text().notNull(),
    ownerId: o.idFk().notNull(),
  });

  const db = await o.testDb({ schema: { users, pets } }, driver, clearRef);
  const result = await db.users.select({
    columns: {
      userId: db.users.id,
      userName: db.users.name,
      pet: {
        id: db.pets.id,
        name: db.pets.name,
      }
    }
  }).join(db.pets, db.users.id.eq(db.pets.ownerId)).execute()

  type _Received = ShallowPrettify<(typeof result)[number]>;
  type Expected = { userId: string; userName: string; pet: { id: string; name: string } };
  expectTypeOf(result).toEqualTypeOf<Expected[]>();

  expect(result).toEqual([
    {
      userId: 'user-1',
      userName: 'Alice',
      pet: { id: 'pet-1', name: 'Fluffy' },
    },
  ]);
});
