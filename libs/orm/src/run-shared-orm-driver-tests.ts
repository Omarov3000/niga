import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, expectTypeOf } from 'vitest';
import { o } from './schema/builder';
import { s } from '@w/schema';
import type { Table } from './schema/table';
import type { Db } from './schema/db';
import { sql } from './utils/sql';
import { OrmDriver, fakeOrmDriver } from './schema/types';
import { ShallowPrettify } from './utils/utils';

// Helper to convert string id to Uint8Array for blob storage
const idToBlob = (id: string) => new TextEncoder().encode(id);

export function runSharedOrmDriverTests(makeDriver: () => OrmDriver, opts: { skipTableCleanup?: boolean } = {}) {

const driver = makeDriver()
const clearRef: { current?: Array<() => Promise<void>> } = { current: [] };

  afterEach(async () => {
  const clearFns = [...(clearRef.current ?? [])];
    clearRef.current = [];

  if (opts.skipTableCleanup) return;
  for (const fn of clearFns.reverse()) {
    await fn();
  }
});

describe('insert', () => {
  it('should insert data and verify via query', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer().default(0),
      email: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insert({
      id: 'test-123',
      name: 'John Doe',
      email: 'john@example.com',
      age: 20,
    });

    const rows = await driver.run({ query: 'SELECT id, name, email, age FROM users WHERE id = ?', params: [idToBlob('test-123')] });

    // Raw driver.run returns Uint8Array for blob columns
    expect(rows).toMatchObject([
      { id: idToBlob('test-123'), name: 'John Doe', email: 'john@example.com', age: 20 },
    ]);
  });

  it('should handle different data types', async () => {
    const posts = o.table('posts', {
      id: o.id(),
      title: o.text(),
      published: o.boolean().default(false),
      views: o.integer().default(0),
    });

    const db = await o.testDb({ schema: { posts } }, driver, clearRef);

    // Check if table exists
    const tables = await driver.run({ query: "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'", params: [] });

    await db.posts.insert({
      id: 'post-123',
      title: 'Test Post',
      published: true,
      views: 42,
    });

    // Check row count
    const count = await driver.run({ query: 'SELECT COUNT(*) as count FROM posts', params: [] });

    const rows = await driver.run({ query: 'SELECT id, title, published, views FROM posts WHERE id = ?', params: [idToBlob('post-123')] });

    expect(rows).toMatchObject([
      { id: idToBlob('post-123'), title: 'Test Post', published: 1, views: 42 },
    ]);
  });

  it('returns app-level model from insert()', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const returned = await db.users.insert({ id: 'user-123', name: 'Alice' });

    expect(returned).toMatchObject({ id: 'user-123', name: 'Alice' });

    const rows = await driver.run({ query: 'SELECT id, name FROM users WHERE id = ?', params: [idToBlob('user-123')] });

    expect(rows).toMatchObject([{ id: idToBlob('user-123'), name: 'Alice' }]);
  });

  it('should maintain type safety', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const model = await db.users.insert({
      id: 'type-safe-test',
      name: 'Type Safe User',
      age: 30,
    });

    expect(model).toMatchObject({ id: 'type-safe-test', name: 'Type Safe User', age: 30 });

    const rows = await driver.run({ query: 'SELECT name, age FROM users WHERE id = ?', params: [idToBlob('type-safe-test')] });

    expect(rows).toMatchObject([{ name: 'Type Safe User', age: 30 }]);
  });

  it('supports insertMany for multiple entries', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const models = await db.users.insertMany([
      { id: 'u1', name: 'Alice', age: 30 },
      { id: 'u2', name: 'Bob', age: 25 },
    ]);

    expect(models).toMatchObject([
      { id: 'u1', name: 'Alice', age: 30 },
      { id: 'u2', name: 'Bob', age: 25 },
    ]);

    const rows = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.id.inArray(['u1','u2'])}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(rows.length).toBe(2);
  });
});

describe('query', () => {
  it('executes simple select via db.query and parses with zod', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver , clearRef);

    // Seed some rows directly
    await driver.run({ query: 'INSERT INTO users (id, name, age) VALUES (?, ?, ?)', params: [idToBlob('u1'), 'Alice', 30] });
    await driver.run({ query: 'INSERT INTO users (id, name, age) VALUES (?, ?, ?)', params: [idToBlob('u2'), 'Bob', 25] });

    const rows = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.age.gte(25)}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ id: 'u1', name: 'Alice', age: 30 });
  });

  it('executeAndTakeFirst returns a single parsed row', async () => {
    const users = o.table('users', { id: o.id(), name: o.text() });
    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [idToBlob('u1'), 'Alice'] });

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.name} FROM users WHERE ${db.users.id.eq('u1')}`
      .executeAndTakeFirst(o.s.object({ id: o.s.id(), name: o.s.text() }));

    expect(row).toMatchObject({ id: 'u1', name: 'Alice' });
  });

  it('supports date/boolean/enum/json via codecs and filters', async () => {
    const profileS = s.object({ bio: s.string() });
    const users = o.table('users', {
      id: o.id(),
      createdAt: o.date(),
      isActive: o.boolean(),
      role: o.enum(['admin', 'user']).default('user'),
      profile: o.json(profileS),
    });
    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    const now = new Date(1700000000000);
    await driver.run({ query: 'INSERT INTO users (id, created_at, is_active, role, profile) VALUES (?, ?, ?, ?, ?)', params: [idToBlob('u1'), now.getTime(), 1, 0, JSON.stringify({ bio: 'Dev' })] });

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.createdAt}, ${db.users.isActive}, ${db.users.role}, ${db.users.profile} FROM users WHERE ${db.users.createdAt.gte(now)} AND ${db.users.isActive.eq(true)} AND ${db.users.role.eq('admin')}`
      .executeAndTakeFirst(o.s.object({
        id: o.s.id(),
        createdAt: o.s.date(),
        isActive: o.s.boolean(),
        role: o.s.enum(users.role.__meta__.enumValues as any, users.role.__meta__.appDefault as any),
        profile: o.s.json(users.profile.__meta__.jsonSchema as any),
      }));

    expect(row.id).toBe('u1');
    expect(row.isActive).toBe(true);
    expect(row.createdAt.getTime()).toBe(now.getTime());
    expect(row.role).toBe('admin');
    expect(row.profile).toMatchObject({ bio: 'Dev' });
  });

  it('supports IN and BETWEEN and IS NULL/NOT NULL filters', async () => {
    const items = o.table('items', {
      id: o.id(),
      price: o.integer(),
      name: o.text(),
    });
    const db = await o.testDb({ schema: { items } }, driver, clearRef);

    await driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: [idToBlob('i1'), 10, 'A'] });
    await driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: [idToBlob('i2'), 20, 'B'] });
    await driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: [idToBlob('i3'), 30, null] });

    const rows = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 25)} AND ${db.items.id.inArray(['i1','i2'])} AND ${db.items.name.isNull()}`
      .execute(o.s.object({ id: o.s.id(), price: o.s.integer() }));

    expect(rows.length).toBe(0);

    const rows2 = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 30)} AND ${db.items.id.inArray(['i1','i3'])} AND ${db.items.name.isNull()}`
      .execute(o.s.object({ id: o.s.id(), price: o.s.integer() }));

    expect(rows2.length).toBe(1);
    expect(rows2[0].id).toBe('i3');
  });

  describe('ordering', () => {
  it('should support column.asc() and column.desc() in ORDER BY clauses', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data in random order
    await db.users.insertMany([
      { id: 'u3', name: 'Charlie', age: 35 },
      { id: 'u1', name: 'Alice', age: 25 },
      { id: 'u4', name: 'David', age: 20 },
      { id: 'u2', name: 'Bob', age: 30 },
    ]);

    // Test ascending order by age
    const ascByAge = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users ORDER BY ${db.users.age.asc()}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(ascByAge).toMatchObject([
      { id: 'u4', name: 'David', age: 20 },
      { id: 'u1', name: 'Alice', age: 25 },
      { id: 'u2', name: 'Bob', age: 30 },
      { id: 'u3', name: 'Charlie', age: 35 },
    ]);

    // Test descending order by age
    const descByAge = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users ORDER BY ${db.users.age.desc()}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(descByAge).toMatchObject([
      { id: 'u3', name: 'Charlie', age: 35 },
      { id: 'u2', name: 'Bob', age: 30 },
      { id: 'u1', name: 'Alice', age: 25 },
      { id: 'u4', name: 'David', age: 20 },
    ]);

    // Test ascending order by name
    const ascByName = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users ORDER BY ${db.users.name.asc()}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(ascByName).toMatchObject([
      { id: 'u1', name: 'Alice', age: 25 },
      { id: 'u2', name: 'Bob', age: 30 },
      { id: 'u3', name: 'Charlie', age: 35 },
      { id: 'u4', name: 'David', age: 20 },
    ]);
  });

  it('should support multiple column ordering', async () => {
    const products = o.table('products', {
      id: o.id(),
      category: o.text(),
      name: o.text(),
      price: o.integer(),
    });

    const db = await o.testDb({ schema: { products } }, driver, clearRef);

    // Insert test data
    await db.products.insertMany([
      { id: 'p1', category: 'electronics', name: 'Phone', price: 800 },
      { id: 'p2', category: 'electronics', name: 'Laptop', price: 1200 },
      { id: 'p3', category: 'books', name: 'Novel', price: 15 },
      { id: 'p4', category: 'books', name: 'Textbook', price: 50 },
      { id: 'p5', category: 'electronics', name: 'Tablet', price: 400 },
    ]);

    // Test ordering by category ASC, then price DESC
    const ordered = await db
      .query`SELECT ${db.products.id}, ${db.products.category}, ${db.products.name}, ${db.products.price} FROM products ORDER BY ${db.products.category.asc()}, ${db.products.price.desc()}`
      .execute(o.s.object({
        id: o.s.id(),
        category: o.s.text(),
        name: o.s.text(),
        price: o.s.integer()
      }));

    expect(ordered).toMatchObject([
      { id: 'p4', category: 'books', name: 'Textbook', price: 50 },
      { id: 'p3', category: 'books', name: 'Novel', price: 15 },
      { id: 'p2', category: 'electronics', name: 'Laptop', price: 1200 },
      { id: 'p1', category: 'electronics', name: 'Phone', price: 800 },
      { id: 'p5', category: 'electronics', name: 'Tablet', price: 400 },
    ]);
  });

  it('should handle ordering with WHERE clauses', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
      status: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insertMany([
      { id: 'u1', name: 'Alice', age: 25, status: 'active' },
      { id: 'u2', name: 'Bob', age: 35, status: 'active' },
      { id: 'u3', name: 'Charlie', age: 20, status: 'inactive' },
      { id: 'u4', name: 'David', age: 30, status: 'active' },
    ]);

    // Test ordering with WHERE filter
    const activeUsersByAge = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.status.eq('active')} ORDER BY ${db.users.age.desc()}`
      .execute(o.s.object({ id: o.s.id(), name: o.s.text(), age: o.s.integer() }));

    expect(activeUsersByAge).toMatchObject([
      { id: 'u2', name: 'Bob', age: 35 },
      { id: 'u4', name: 'David', age: 30 },
      { id: 'u1', name: 'Alice', age: 25 },
    ]);
  });
});

describe('aggregate functions', () => {
  it('should support COUNT() aggregate function', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
      status: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insertMany([
      { id: 'u1', name: 'Alice', age: 25, status: 'active' },
      { id: 'u2', name: 'Bob', age: 35, status: 'active' },
      { id: 'u3', name: 'Charlie', age: 20, status: 'inactive' },
      { id: 'u4', name: 'David', age: 30, status: 'active' },
    ]);

    // Test COUNT(*) equivalent
    const totalUsers = await db
      .query`SELECT ${db.users.id.count()} FROM users`
      .executeAndTakeFirst(o.s.object({ userCount: o.s.integer() }));

    expect(totalUsers?.userCount).toBe(4);

    // Test COUNT with WHERE clause
    const activeUsers = await db
      .query`SELECT ${db.users.id.count()} FROM users WHERE ${db.users.status.eq('active')}`
      .executeAndTakeFirst(o.s.object({ userCount: o.s.integer() }));

    expect(activeUsers?.userCount).toBe(3);
  });

  it('should support MAX() aggregate function', async () => {
    const products = o.table('products', {
      id: o.id(),
      name: o.text(),
      price: o.integer(),
      category: o.text(),
    });

    const db = await o.testDb({ schema: { products } }, driver, clearRef);

    await db.products.insertMany([
      { id: 'p1', name: 'Phone', price: 800, category: 'electronics' },
      { id: 'p2', name: 'Laptop', price: 1200, category: 'electronics' },
      { id: 'p3', name: 'Book', price: 25, category: 'books' },
      { id: 'p4', name: 'Tablet', price: 400, category: 'electronics' },
    ]);

    // Test MAX(price)
    const maxPrice = await db
      .query`SELECT ${db.products.price.max()} FROM products`
      .executeAndTakeFirst(o.s.object({ maxValue: o.s.integer() }));

    expect(maxPrice?.maxValue).toBe(1200);

    // Test MAX with WHERE clause
    const maxElectronicsPrice = await db
      .query`SELECT ${db.products.price.max()} FROM products WHERE ${db.products.category.eq('electronics')}`
      .executeAndTakeFirst(o.s.object({ maxValue: o.s.integer() }));

    expect(maxElectronicsPrice?.maxValue).toBe(1200);

    // Test MAX on text column
    const maxName = await db
      .query`SELECT ${db.products.name.max()} FROM products`
      .executeAndTakeFirst(o.s.object({ maxValue: o.s.text() }));

    expect(maxName?.maxValue).toBe('Tablet'); // Alphabetically last
  });

  it('should support increment() virtual column', async () => {
    const accounts = o.table('accounts', {
      id: o.id(),
      balance: o.integer(),
      bonus: o.integer().default(0),
    });

    const db = await o.testDb({ schema: { accounts } }, driver, clearRef);

    await db.accounts.insertMany([
      { id: 'acc1', balance: 100, bonus: 10 },
      { id: 'acc2', balance: 250, bonus: 25 },
      { id: 'acc3', balance: 500, bonus: 50 },
    ]);

    // Test increment() with default amount (1)
    const incrementedBalances = await db
      .query`SELECT ${db.accounts.id}, ${db.accounts.balance.increment()} FROM accounts ORDER BY ${db.accounts.id.asc()}`
      .execute(o.s.object({ id: o.s.id(), nextValue: o.s.integer() }));

    expect(incrementedBalances).toMatchObject([
      { id: 'acc1', nextValue: 101 },
      { id: 'acc2', nextValue: 251 },
      { id: 'acc3', nextValue: 501 },
    ]);

    // Test increment() with custom amount
    const bonusBalances = await db
      .query`SELECT ${db.accounts.id}, ${db.accounts.balance.increment(100)} FROM accounts WHERE ${db.accounts.balance.gte(200)} ORDER BY ${db.accounts.id.asc()}`
      .execute(o.s.object({ id: o.s.id(), nextValue: o.s.integer() }));

    expect(bonusBalances).toMatchObject([
      { id: 'acc2', nextValue: 350 },
      { id: 'acc3', nextValue: 600 },
    ]);
  });

  it('should combine multiple aggregate functions', async () => {
    const sales = o.table('sales', {
      id: o.id(),
      product: o.text(),
      amount: o.integer(),
      region: o.text(),
    });

    const db = await o.testDb({ schema: { sales } }, driver, clearRef);

    await db.sales.insertMany([
      { id: 's1', product: 'Widget A', amount: 100, region: 'North' },
      { id: 's2', product: 'Widget B', amount: 200, region: 'North' },
      { id: 's3', product: 'Widget A', amount: 150, region: 'South' },
      { id: 's4', product: 'Widget C', amount: 300, region: 'North' },
    ]);

    // Combine COUNT and MAX in same query
    const stats = await db
      .query`SELECT
        ${db.sales.id.count()},
        ${db.sales.amount.max()}
        FROM sales
        WHERE ${db.sales.region.eq('North')}`
      .executeAndTakeFirst(o.s.object({
        userCount: o.s.integer(),
        maxValue: o.s.integer()
      }));

    expect(stats).toMatchObject({
      userCount: 3,
      maxValue: 300
    });
  });
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

    await driver.run({ query: 'INSERT INTO users (id, name, has_pet) VALUES (?, ?, ?)', params: [1, 'Alice', 1] });
    await driver.run({ query: 'INSERT INTO users (id, name, has_pet) VALUES (?, ?, ?)', params: [2, 'Bob', 0] });

    const result = await db.users.select().execute();

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { id: 1, name: 'Alice', hasPet: true },
      { id: 2, name: 'Bob', hasPet: false }
    ]));

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

    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] });

    const result = await db.users.select({ columns: { userId: db.users.id } }).executeAndTakeFirst();

    expect(result).toMatchObject({ userId: 1 });

    type _Received = ShallowPrettify<typeof result>;
    type Expected = { userId: number };
    expectTypeOf(result).toEqualTypeOf<Expected>();
  });

  it('selects with where', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      name: o.text().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] });
    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [2, 'Bob'] });

    const result = await db.users.select({ where: db.users.id.eq(1) }).execute();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, name: 'Alice' });
  });

  it('selects with order by', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      name: o.text().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Bob'] });
    await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [2, 'Alice'] });

    const result = await db.users.select({ orderBy: db.users.name.asc() }).execute();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Bob');
  });

  it('selects with limit and offset', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      name: o.text().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    for (let i = 0; i < 15; i++) {
      await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [i + 1, `User${i}`] });
    }

    const result = await db.users.select({ limit: 3, offset: 2 }).execute();

    expect(result).toHaveLength(3);
  });

  it('selects with group by', async () => {
    const users = o.table('users', {
      id: o.integer().notNull(),
      age: o.integer().notNull(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await driver.run({ query: 'INSERT INTO users (id, age) VALUES (?, ?)', params: [1, 25] });
    await driver.run({ query: 'INSERT INTO users (id, age) VALUES (?, ?)', params: [2, 25] });
    await driver.run({ query: 'INSERT INTO users (id, age) VALUES (?, ?)', params: [3, 30] });

    const result = await db.users.select({ columns: { age: db.users.age, count: db.users.id.count() }, groupBy: db.users.age }).execute();

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { age: 25, count: 2 },
      { age: 30, count: 1 }
    ]));

    type _Received = ShallowPrettify<(typeof result)[number]>;
    type Expected = { age: number; count: number };
    expectTypeOf(result).toEqualTypeOf<Expected[]>();
  });

  describe('joins', () => {
    it('joins', async () => {
      const users = o.table('users', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
      });

      const pets = o.table('pets', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
        ownerId: o.integer().notNull(),
      });

      const db = await o.testDb({ schema: { users, pets } }, driver, clearRef);

      await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] });
      await driver.run({ query: 'INSERT INTO pets (id, name, owner_id) VALUES (?, ?, ?)', params: [1, 'Fluffy', 1] });

      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId));
      const result = await query.execute();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        users: { id: 1, name: 'Alice' },
        pets: { id: 1, name: 'Fluffy', ownerId: 1 }
      });

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: number; name: string }; pets: { id: number; name: string; ownerId: number } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('joins with flat return type', async () => {
      const users = o.table('users', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
      });

      const pets = o.table('pets', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
        ownerId: o.integer().notNull(),
      });

      const db = await o.testDb({ schema: { users, pets } }, driver, clearRef);

      await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] });
      await driver.run({ query: 'INSERT INTO pets (id, name, owner_id) VALUES (?, ?, ?)', params: [1, 'Fluffy', 1] });

      const result = await db.users.select({ columns: { id: db.users.id, petId: db.pets.id } }).join(db.pets, db.users.id.eq(db.pets.ownerId)).execute();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 1, petId: 1 });

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { id: number; petId: number };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('self join', async () => {
      const users = o.table('users', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
        parentId: o.integer(),
      });

      const db = await o.testDb({ schema: { users } }, driver, clearRef);

      await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Parent'] });
      await driver.run({ query: 'INSERT INTO users (id, name, parent_id) VALUES (?, ?, ?)', params: [2, 'Child', 1] });

      const parent = db.users.as('parent');
      const query = db.users.select().leftJoin(parent, db.users.parentId.eq(parent.id));
      const result = await query.execute();

      expect(result).toHaveLength(2);
      const childResult = result.find(r => r.users.name === 'Child');
      expect(childResult).toMatchObject({
        users: { id: 2, name: 'Child', parentId: 1 },
        parent: { id: 1, name: 'Parent', parentId: null }
      });

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: number; name: string; parentId: number | undefined }; parent: { id: number; name: string; parentId: number | undefined } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });

    it('triple join', async () => {
      const users = o.table('users', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
      });

      const pets = o.table('pets', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
        ownerId: o.integer().notNull(),
      });

      const toys = o.table('toys', {
        id: o.integer().notNull(),
        name: o.text().notNull(),
        petId: o.integer().notNull(),
      });

      const db = await o.testDb({ schema: { users, pets, toys } }, driver, clearRef);

      await driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [1, 'Alice'] });
      await driver.run({ query: 'INSERT INTO pets (id, name, owner_id) VALUES (?, ?, ?)', params: [1, 'Fluffy', 1] });
      await driver.run({ query: 'INSERT INTO toys (id, name, pet_id) VALUES (?, ?, ?)', params: [1, 'Ball', 1] });

      const query = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId)).join(db.toys, db.pets.id.eq(db.toys.petId));
      const result = await query.execute();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        users: { id: 1, name: 'Alice' },
        pets: { id: 1, name: 'Fluffy', ownerId: 1 },
        toys: { id: 1, name: 'Ball', petId: 1 }
      });

      type _Received = ShallowPrettify<(typeof result)[number]>;
      type Expected = { users: { id: number; name: string }; pets: { id: number; name: string; ownerId: number }; toys: { id: number; name: string; petId: number } };
      expectTypeOf(result).toEqualTypeOf<Expected[]>();
    });
  })

  describe('encode/decode and snake casing', () => {
    it('properly decodes boolean values and handles snake case column names', async () => {
      const users = o.table('users', {
        id: o.integer().notNull(),
        firstName: o.text().notNull(), // camelCase -> snake_case
        isActive: o.boolean(),         // camelCase -> snake_case
        hasPermissions: o.boolean().notNull(), // camelCase -> snake_case
      });

      const db = await o.testDb({ schema: { users } }, driver, clearRef);

      await driver.run({
        query: 'INSERT INTO users (id, first_name, is_active, has_permissions) VALUES (?, ?, ?, ?)',
        params: [1, 'John', 1, 0]
      });
      await driver.run({
        query: 'INSERT INTO users (id, first_name, has_permissions) VALUES (?, ?, ?)',
        params: [2, 'Jane', 1]
      });

      const result = await db.users.select().execute();

      expect(result).toHaveLength(2);

      // Verify that boolean 1 decodes to true and 0 decodes to false
      expect(result[0]).toMatchObject({
        id: 1,
        firstName: 'John',
        isActive: true,      // 1 should decode to true
        hasPermissions: false // 0 should decode to false
      });

      // Verify that NULL boolean decodes to null (not false)
      expect(result[1]).toMatchObject({
        id: 2,
        firstName: 'Jane',
        isActive: null,      // NULL should stay null
        hasPermissions: true // 1 should decode to true
      });

      // Test WHERE clause with boolean values
      const activeUsers = await db.users.select({ where: db.users.isActive.eq(true) }).execute();
      expect(activeUsers).toHaveLength(1);
      expect(activeUsers[0].firstName).toBe('John');

      // Test WHERE clause with column that has snake_case name
      const johnUser = await db.users.select({ where: db.users.firstName.eq('John') }).execute();
      expect(johnUser).toHaveLength(1);
      expect(johnUser[0].isActive).toBe(true);
    });
  })
});

describe('update', () => {
  it('should update data with WHERE clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer().default(0),
      email: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data
    await db.users.insert({
      id: 'user-1',
      name: 'John Doe',
      email: 'john@example.com',
      age: 25,
    });

    await db.users.insert({
      id: 'user-2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      age: 30,
    });

    // Update user-1's age and name
    await db.users.update({
      data: { name: 'Johnny Doe', age: 26 },
      where: users.id.eq('user-1'),
    });

    // Verify user-1 was updated
    const updatedUserResults = await driver.run({ query: 'SELECT id, name, age FROM users WHERE id = ?', params: [idToBlob('user-1')] });
    const updatedUser = updatedUserResults[0];
    expect(updatedUser).toMatchObject({ id: idToBlob('user-1'), name: 'Johnny Doe', age: 26 });

    // Verify user-2 was not affected
    const unchangedUserResults = await driver.run({ query: 'SELECT id, name, age FROM users WHERE id = ?', params: [idToBlob('user-2')] });
    const unchangedUser = unchangedUserResults[0];
    expect(unchangedUser).toMatchObject({ id: idToBlob('user-2'), name: 'Jane Smith', age: 30 });
  });

  it('should handle different data types in updates', async () => {
    const posts = o.table('posts', {
      id: o.id(),
      title: o.text(),
      published: o.boolean().default(false),
      views: o.integer().default(0),
    });

    const db = await o.testDb({ schema: { posts } }, driver , clearRef);

    // Insert test data
    await db.posts.insert({
      id: 'post-1',
      title: 'Draft Post',
      published: false,
      views: 5,
    });

    // Update to publish the post
    await db.posts.update({
      data: { title: 'Published Post', published: true, views: 100 },
      where: posts.id.eq('post-1'),
    });

    // Verify update (boolean stored as integer)
    const updatedPostResults = await driver.run({ query: 'SELECT id, title, published, views FROM posts WHERE id = ?', params: [idToBlob('post-1')] });
    const updatedPost = updatedPostResults[0];
    expect(updatedPost).toMatchObject({
      id: idToBlob('post-1'),
      title: 'Published Post',
      published: 1, // boolean true stored as 1
      views: 100
    });
  });

  it('should apply $onUpdateFn when updating', async () => {
    let updateCallCount = 0;
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      updatedAt: o.date().$onUpdateFn(() => {
        updateCallCount++;
        return new Date(1700000000000); // Fixed timestamp for testing
      }),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data
    await db.users.insert({
      id: 'user-1',
      name: 'John Doe',
      updatedAt: new Date(1600000000000), // Earlier timestamp
    });

    // Update user
    await db.users.update({
      data: { name: 'Johnny Doe' },
      where: users.id.eq('user-1'),
    });

    // Verify onUpdate function was called
    expect(updateCallCount).toBe(1);

    // Verify updatedAt was updated to the onUpdate value
    const updatedUserResults = await driver.run({ query: 'SELECT id, name, updated_at FROM users WHERE id = ?', params: [idToBlob('user-1')] });
    const updatedUser = updatedUserResults[0];
    expect(updatedUser).toMatchObject({
      id: idToBlob('user-1'),
      name: 'Johnny Doe',
      updated_at: 1700000000000 // The fixed timestamp from onUpdate
    });
  });

  it('supports update expressions via column.set', async () => {
    const accounts = o.table('accounts', {
      id: o.id(),
      userId: o.text(),
      balance: o.integer().default(0),
    });

    const db = await o.testDb({ schema: { accounts } }, driver, clearRef);

    await db.accounts.insert({
      id: 'acc-1',
      userId: 'user-1',
      balance: 200,
    });

    await db.accounts.update({
      data: { balance: accounts.balance.set`+ ${50}` },
      where: accounts.userId.eq('user-1'),
    });

    const updatedAccountResults = await driver.run({ query: 'SELECT balance FROM accounts WHERE user_id = ?', params: ['user-1'] });
    const updatedAccount = updatedAccountResults[0];
    expect(updatedAccount.balance).toBe(250);
  });

  it('should update multiple rows with WHERE clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
      status: o.text().default('active'),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data
    await db.users.insertMany([
      { id: 'user-1', name: 'John', age: 25, status: 'active' },
      { id: 'user-2', name: 'Jane', age: 30, status: 'active' },
      { id: 'user-3', name: 'Bob', age: 35, status: 'inactive' },
    ]);

    // Update all active users older than 28
    await db.users.update({
      data: { status: 'senior' },
      where: sql`${users.age.gte(28)} AND ${users.status.eq('active')}`,
    });

    // Verify only user-2 was updated
    const allUsers = await driver.run({ query: 'SELECT id, status FROM users ORDER BY id', params: [] });
    expect(allUsers).toMatchObject([
      { id: idToBlob('user-1'), status: 'active' }, // age 25, not updated
      { id: idToBlob('user-2'), status: 'senior' }, // age 30, updated
      { id: idToBlob('user-3'), status: 'inactive' }, // inactive, not updated
    ]);
  });

  it('should throw error when no columns to update', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insert({
      id: 'user-1',
      name: 'John',
    });

    // Try to update with no data
    await expect(db.users.update({
      data: {},
      where: sql`${users.id.eq('user-1')}`,
    })).rejects.toThrow('No columns to update');
  });

  it('should parse UPDATE query for security analysis', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insert({
      id: 'user-1',
      name: 'John',
      age: 25,
    });

    // This should not throw - security parsing should succeed for valid UPDATE
    await expect(db.users.update({
      data: { name: 'Johnny', age: 26 },
      where: sql`${users.id.eq('user-1')}`,
    })).resolves.not.toThrow();

    // Verify the update actually worked
    const updatedUserResults = await driver.run({ query: 'SELECT id, name, age FROM users WHERE id = ?', params: [idToBlob('user-1')] });
    const updatedUser = updatedUserResults[0];
    expect(updatedUser).toMatchObject({ id: idToBlob('user-1'), name: 'Johnny', age: 26 });
  });

  it('should handle malformed UPDATE queries in security parsing', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Create a malformed RawSql object that should trigger parsing errors
    const malformedSql: any = {
      query: 'UPDATE users SET name = ? WHERE id = ? AND INVALID SYNTAX',
      params: ['test', 'user-1']
    };

    // The security parsing should catch malformed SQL
    await expect(users.update({
      data: { name: 'test' },
      where: malformedSql,
    })).rejects.toThrow();
  });
});

describe('delete', () => {
  it('should delete data with WHERE clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
    });

    const db = await o.testDb({ schema: { users } }, driver   , clearRef);

    // Insert test data
    await db.users.insertMany([
      { id: 'user-1', name: 'John Doe', age: 25 },
      { id: 'user-2', name: 'Jane Smith', age: 30 },
      { id: 'user-3', name: 'Bob Johnson', age: 35 },
    ]);

    // Delete user-2
    await db.users.delete({
      where: sql`${users.id.eq('user-2')}`,
    });

    // Verify user-2 was deleted
    const remainingUsers = await driver.run({ query: 'SELECT id, name FROM users ORDER BY id', params: [] });
    expect(remainingUsers).toMatchObject([
      { id: idToBlob('user-1'), name: 'John Doe' },
      { id: idToBlob('user-3'), name: 'Bob Johnson' },
    ]);
  });

  it('should delete multiple rows with WHERE clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      age: o.integer(),
      status: o.text().default('active'),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data
    await db.users.insertMany([
      { id: 'user-1', name: 'John', age: 25, status: 'active' },
      { id: 'user-2', name: 'Jane', age: 30, status: 'inactive' },
      { id: 'user-3', name: 'Bob', age: 35, status: 'inactive' },
      { id: 'user-4', name: 'Alice', age: 28, status: 'active' },
    ]);

    // Delete all inactive users
    await db.users.delete({
      where: sql`${users.status.eq('inactive')}`,
    });

    // Verify only active users remain
    const remainingUsers = await driver.run({ query: 'SELECT id, name, status FROM users ORDER BY id', params: [] });
    expect(remainingUsers).toMatchObject([
      { id: idToBlob('user-1'), name: 'John', status: 'active' },
      { id: idToBlob('user-4'), name: 'Alice', status: 'active' },
    ]);
  });

  it('should delete with complex WHERE conditions', async () => {
    const posts = o.table('posts', {
      id: o.id(),
      title: o.text(),
      views: o.integer().default(0),
      published: o.boolean().default(false),
    });

    const db = await o.testDb({ schema: { posts } }, driver, clearRef);

    // Insert test data
    await db.posts.insertMany([
      { id: 'post-1', title: 'Draft 1', views: 5, published: false },
      { id: 'post-2', title: 'Published 1', views: 100, published: true },
      { id: 'post-3', title: 'Draft 2', views: 2, published: false },
      { id: 'post-4', title: 'Published 2', views: 50, published: true },
    ]);

    // Delete unpublished posts with low views
    await db.posts.delete({
      where: sql`${posts.published.eq(false)} AND ${posts.views.lt(10)}`,
    });

    // Verify only published posts and high-view drafts remain
    const remainingPosts = await driver.run({ query: 'SELECT id, title, views, published FROM posts ORDER BY id', params: [] });
    expect(remainingPosts).toMatchObject([
      { id: idToBlob('post-2'), title: 'Published 1', views: 100, published: 1 },
      { id: idToBlob('post-4'), title: 'Published 2', views: 50, published: 1 },
    ]);
  });

  it('should handle delete with IN clause', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Insert test data
    await db.users.insertMany([
      { id: 'user-1', name: 'John' },
      { id: 'user-2', name: 'Jane' },
      { id: 'user-3', name: 'Bob' },
      { id: 'user-4', name: 'Alice' },
    ]);

    // Delete specific users by ID
    await db.users.delete({
      where: sql`${users.id.inArray(['user-1', 'user-3'])}`,
    });

    // Verify only user-2 and user-4 remain
    const remainingUsers = await driver.run({ query: 'SELECT id, name FROM users ORDER BY id', params: [] });
    expect(remainingUsers).toMatchObject([
      { id: idToBlob('user-2'), name: 'Jane' },
      { id: idToBlob('user-4'), name: 'Alice' },
    ]);
  });

  it('should parse DELETE query for security analysis', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insert({
      id: 'user-1',
      name: 'John',
    });

    // This should not throw - security parsing should succeed for valid DELETE
    await expect(db.users.delete({
      where: sql`${users.id.eq('user-1')}`,
    })).resolves.not.toThrow();

    // Verify the delete actually worked
    const remainingUsers = await driver.run({ query: 'SELECT id FROM users', params: [] });
    expect(remainingUsers).toHaveLength(0);
  });

  it('should handle malformed DELETE queries in security parsing', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    // Create a malformed RawSql object that should trigger parsing errors
    const malformedSql: any = {
      query: 'id = ? AND INVALID SYNTAX',
      params: [idToBlob('user-1')]
    };

    // The security parsing should catch malformed SQL
    await expect(users.delete({
      where: malformedSql,
    })).rejects.toThrow();
  });

  it('should delete no rows when WHERE clause matches nothing', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await db.users.insertMany([
      { id: 'user-1', name: 'John' },
      { id: 'user-2', name: 'Jane' },
    ]);

    // Delete non-existent user
    await db.users.delete({
      where: sql`${users.id.eq('user-999')}`,
    });

    // Verify no users were deleted
    const remainingUsers = await driver.run({ query: 'SELECT id FROM users', params: [] });
    expect(remainingUsers).toHaveLength(2);
  });
});

describe('transaction', () => {
  it('rolls back earlier statements when a later statement fails', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    const db = await o.testDb({ schema: { users } }, driver, clearRef);

    await expect(
      db.transaction(async (tx) => {
        await tx.users.insert({ id: 'u1', name: 'Alice' });
        // This violates the PRIMARY KEY constraint (duplicate id)
        await tx.users.insert({ id: 'u1', name: 'Duplicate' });
      })
    ).rejects.toThrow();

    const rows = await driver.run({ query: 'SELECT id, name FROM users WHERE id = ?', params: [idToBlob('u1')] });
    expect(rows).toMatchObject([]);
  });
});

describe('batch', () => {
  it('rolls back earlier statements when a later statement fails', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    await o.testDb({ schema: { users } }, driver, clearRef)

    await expect(
      driver.batch([
        { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [idToBlob('u1'), 'Alice'] },
        { query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: [idToBlob('u1'), 'Duplicate'] },
      ])
    ).rejects.toThrow()

    const rows = await driver.run({ query: 'SELECT id, name FROM users WHERE id = ?', params: [idToBlob('u1')] })
    expect(rows).toMatchObject([])
  })
})

  return {driver, clearRef}
}
