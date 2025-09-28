import { describe, it, expect, afterEach, expectTypeOf } from 'vitest';
import { b } from './builder';
import { Expect, Equal, ShallowPrettify, DiffAb } from './utils';
import { BinNodeDriver } from './bin-node-driver';
import { SelectQueryBuilder } from './table';
// import { NoDiff } from './diff-ab';

const clearRef: { current?: Array<() => Promise<void>> } = { current: [] };
afterEach(async () => {
  const clearFns = [...(clearRef.current ?? [])];
    clearRef.current = [];

  for (const fn of clearFns.reverse()) {
    await fn();
  }
});
const driver = new BinNodeDriver()

describe('select', () => {
  it('selects many', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text().notNull(),
      hasPet: b.boolean(), // optional
    });

    const db = await b.testDb({ schema: { users } }, driver, clearRef);

    const result = await db.users.select().execute();

    // TODO: expect call

    type Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { id: string; name: string; hasPet: boolean | undefined };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });

  it('selects partial with alias', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text().notNull(),
    });

    const db = await b.testDb({ schema: { users } }, driver, clearRef);

    const result = await db.users.select({ columns: { userId: db.users.id } }).executeAndTakeFirst();

    // TODO: expect call

    type Received = ShallowPrettify<typeof result>;
    type Expected = { userId: string };
    expectTypeOf(result).toEqualTypeOf<Expected>();
  });

  it('selects with group by', async () => {
    const users = b.table('users', {
      id: b.id(),
      age: b.integer().notNull(),
    });

    const db = await b.testDb({ schema: { users } }, driver, clearRef);

    const result = await db.users.select({ columns: { age: db.users.age, count: db.users.id.count() }, groupBy: db.users.age }).execute();

    // TODO: expect call

    type Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { age: number; count: number };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });

  describe('joins', () => {
    it('joins', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
      });

      const pets = b.table('pets', {
        id: b.id(),
        name: b.text().notNull(),
        ownerId: b.id(),
      });

      const db = await b.testDb({ schema: { users, pets } }, driver, clearRef);

      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId));
      type QueryType = typeof query;
      type Mode = QueryType extends SelectQueryBuilder<any, any, any, infer M>
  ? M
  : never;
      const result = await query.execute();

      // TODO: expect call

      type Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string }; pets: { id: string; name: string; ownerId: string } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('joins with flat return type', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
      });

      const pets = b.table('pets', {
        id: b.id(),
        name: b.text().notNull(),
        ownerId: b.id(),
      });

      const db = await b.testDb({ schema: { users, pets } }, driver, clearRef);

      const result = await db.users.select({ columns: { id: db.users.id, petId: db.pets.id } }).join(db.pets, db.users.id.eq(db.pets.ownerId)).execute();

      // TODO: expect call

      type Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { id: string; petId: string };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('self join', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        parentId: b.text(),
      });

      const db = await b.testDb({ schema: { users } }, driver, clearRef);

      const parent = db.users.as('parent');
      const query = db.users.select().leftJoin(parent, db.users.id.eq(parent.parentId));
      const result = await query.execute();

      // TODO: expect call

      type Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string; parentId: string | undefined }; parent: { id: string; name: string; parentId: string | undefined } };
      type Diff = DiffAb<Received, Expected>;
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('triple join', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
      });

      const pets = b.table('pets', {
        id: b.id(),
        name: b.text().notNull(),
        ownerId: b.id(),
      });

      const toys = b.table('toys', {
        id: b.id(),
        name: b.text().notNull(),
        petId: b.id(),
      });

      const db = await b.testDb({ schema: { users, pets, toys } }, driver, clearRef);

      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId)).join(db.toys, db.pets.id.eq(db.toys.petId));
      const result = await query.execute();

      // TODO: expect call

      type Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string }; pets: { id: string; name: string; ownerId: string }; toys: { id: string; name: string; petId: string } };
      type Diff = DiffAb<Received, Expected>;
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });
  })
});
