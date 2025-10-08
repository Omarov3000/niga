import { describe, expectTypeOf, it } from 'vitest';
import { o } from './builder';
import { ShallowPrettify } from '../utils/utils';
import { fakeOrmDriver } from './types';

const driver = fakeOrmDriver;
const clearRef: { current?: Array<() => Promise<void>> } = { current: [] };

describe('insert', () => {
  it('validates insert data types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const result = await db.users.insert({ id: 'user-1', name: 'Alice', age: 30 });

    type _Received = ShallowPrettify<typeof result>;
    type Expected = { id: string; name: string; age: number };
    expectTypeOf(result).toEqualTypeOf<Expected>();

    // @ts-expect-error - age should be number, not string
    await db.users.insert({ id: 'user-2', name: 'Bob', age: '25' });

    // @ts-expect-error - missing required field 'age'
    await db.users.insert({ id: 'user-3', name: 'Charlie' });
  });
});

describe('insertMany', () => {
  it('validates insertMany data types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const result = await db.users.insertMany([
      { id: 'user-1', name: 'Alice', age: 30 },
      { id: 'user-2', name: 'Bob', age: 25 }
    ]);

    type _Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { id: string; name: string; age: number };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();

    // @ts-expect-error - age should be number, not string
    await db.users.insertMany([{ id: 'user-3', name: 'Charlie', age: '20' }]);

    // @ts-expect-error - name should be string, not number
    await db.users.insertMany([{ id: 'user-4', name: 123, age: 30 }]);
  });
});

describe('update', () => {
  it('validates update data types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.update({
      data: { name: 'Alice Updated', age: 31 },
      where: users.id.eq('user-1'),
    });

    await db.users.update({
      // @ts-expect-error - age should be number, not string
      data: { age: '32' },
      where: users.id.eq('user-1'),
    });

    await db.users.update({
      // @ts-expect-error - invalid field 'email'
      data: { email: 'test@example.com' },
      where: users.id.eq('user-1'),
    });
  });
});

describe('query', () => {
  it('validates query result types', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const result = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.age.gte(25)}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    type _Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { id: string; name: string; age: number };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });
});

describe('select', () => {
  it('selects many', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      name: o.text().notNull(),
      hasPet: o.boolean(), // optional
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);
    const result = await db.users.select().execute();

    type _Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { id: number; name: string; hasPet: boolean | undefined };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });

  it('selects partial with alias', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      name: o.text().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);
    const result = await db.users.select({ columns: { userId: db.users.id } }).executeAndTakeFirst();

    type _Received = ShallowPrettify<typeof result>;
    type Expected = { userId: number };
    expectTypeOf(result).toEqualTypeOf<Expected>();
  });

  it('selects with group by', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);
    const result = await db.users.select({ columns: { age: db.users.age, count: db.users.id.count() }, groupBy: db.users.age }).execute();

    type _Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { age: number; count: number };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });

  describe('joins', () => {
    it('joins', async () => {
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
      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId));
      const result = await query.execute();

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string }; pets: { id: string; name: string; ownerId: string } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('joins with flat return type', async () => {
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
      const result = await db.users.select({ columns: { id: db.users.id, petId: db.pets.id } }).join(db.pets, db.users.id.eq(db.pets.ownerId)).execute();

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { id: string; petId: string };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('self join', async () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().notNull(),
        parentId: o.idFk(),
      });

      const db = await o.testDb({ schema: { users } }, driver, clearRef);
      const parent = db.users.as('parent');
      const query = db.users.select().leftJoin(parent, db.users.parentId.eq(parent.id));
      const result = await query.execute();

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string; parentId: string | undefined }; parent: { id: string; name: string; parentId: string | undefined } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('triple join', async () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().notNull(),
      });

      const pets = o.table('pets', {
        id: o.id(),
        name: o.text().notNull(),
        ownerId: o.idFk().notNull(),
      });

      const toys = o.table('toys', {
        id: o.id(),
        name: o.text().notNull(),
        petId: o.idFk().notNull(),
      });

      const db = await o.testDb({ schema: { users, pets, toys } }, driver, clearRef);
      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId)).join(db.toys, db.pets.id.eq(db.toys.petId));
      const result = await query.execute();

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: string; name: string }; pets: { id: string; name: string; ownerId: string }; toys: { id: string; name: string; petId: string } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
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

      // Insert test data
      await db.users.insert({ id: 'user-1', name: 'Alice' });
      await db.pets.insert({ id: 'pet-1', name: 'Fluffy', ownerId: 'user-1' });

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
    });

  });
});
