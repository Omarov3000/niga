import { describe, it, expect, beforeEach } from 'vitest';
import { b } from './builder';
import { BinNodeDriver } from './bin-node-driver';
import { z } from 'zod';
import type { Table } from './table';
import type { Db } from './db';

let driver: BinNodeDriver;

beforeEach(() => {
  driver = new BinNodeDriver(':memory:');
});

async function prepareForTest<TSchema extends Record<string, Table<any, any>>>(
  schema: TSchema
): Promise<Db & TSchema> {
  const db = b.db({ schema }) as Db & TSchema;
  await db._connectDriver(driver);
  driver.exec(db.getSchemaDefinition());
  return db;
}

describe('insert', () => {
  it('should insert data and verify via query', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer().default(0),
      email: b.text(),
    });

    const db = await prepareForTest({ users });

    await users.insert({
      id: 'test-123',
      name: 'John Doe',
      email: 'john@example.com',
      age: 20,
    });

    const rows = driver.db.prepare('SELECT id, name, email, age FROM users WHERE id = ?').all(['test-123']);

    expect(rows).toMatchObject([
      { id: 'test-123', name: 'John Doe', email: 'john@example.com', age: 20 },
    ]);
  });

  it('should handle different data types', async () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text(),
      published: b.boolean().default(false),
      views: b.integer().default(0),
    });

    const db = await prepareForTest({ posts });

    await posts.insert({
      id: 'post-123',
      title: 'Test Post',
      published: true,
      views: 42,
    });

    const rows = driver.db.prepare('SELECT id, title, published, views FROM posts WHERE id = ?').all(['post-123']);

    expect(rows).toMatchObject([
      { id: 'post-123', title: 'Test Post', published: 1, views: 42 },
    ]);
  });

  it('returns app-level model from insert()', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    const returned = await users.insert({ id: 'user-123', name: 'Alice' });

    expect(returned).toMatchObject({ id: 'user-123', name: 'Alice' });

    const rows = driver.db.prepare('SELECT id, name FROM users WHERE id = ?').all(['user-123']);

    expect(rows).toMatchObject([{ id: 'user-123', name: 'Alice' }]);
  });

  it('should maintain type safety', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = await prepareForTest({ users });

    const model = await users.insert({
      id: 'type-safe-test',
      name: 'Type Safe User',
      age: 30,
    });

    expect(model).toMatchObject({ id: 'type-safe-test', name: 'Type Safe User', age: 30 });

    const rows = driver.db.prepare('SELECT name, age FROM users WHERE id = ?').all(['type-safe-test']);

    expect(rows).toMatchObject([{ name: 'Type Safe User', age: 30 }]);
  });

  it('supports insertMany for multiple entries', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = await prepareForTest({ users });

    const models = await users.insertMany([
      { id: 'u1', name: 'Alice', age: 30 },
      { id: 'u2', name: 'Bob', age: 25 },
    ]);

    expect(models).toMatchObject([
      { id: 'u1', name: 'Alice', age: 30 },
      { id: 'u2', name: 'Bob', age: 25 },
    ]);

    const rows = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.id.inArray(['u1','u2'])}`
      .execute(b.z.object({ id: b.z.id(), name: b.z.text(), age: b.z.integer() }));

    expect(rows.length).toBe(2);
  });
});

describe('select', () => {
  it('executes simple select via db.query and parses with zod', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = await prepareForTest({ users });

    // Seed some rows directly
    driver.db.prepare('INSERT INTO users (id, name, age) VALUES (?, ?, ?)').run(['u1', 'Alice', 30]);
    driver.db.prepare('INSERT INTO users (id, name, age) VALUES (?, ?, ?)').run(['u2', 'Bob', 25]);

    const rows = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.age.gte(25)}`
      .execute(b.z.object({ id: b.z.id(), name: b.z.text(), age: b.z.integer() }));

    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ id: 'u1', name: 'Alice', age: 30 });
  });

  it('executeAndTakeFirst returns a single parsed row', async () => {
    const users = b.table('users', { id: b.id(), name: b.text() });
    const db = await prepareForTest({ users });

    driver.db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(['u1', 'Alice']);

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.name} FROM users WHERE ${db.users.id.eq('u1')}`
      .executeAndTakeFirst(b.z.object({ id: b.z.id(), name: b.z.text() }));

    expect(row).toMatchObject({ id: 'u1', name: 'Alice' });
  });

  it('supports date/boolean/enum/json via codecs and filters', async () => {
    const profileZ = z.object({ bio: z.string() });
    const users = b.table('users', {
      id: b.id(),
      createdAt: b.date(),
      isActive: b.boolean(),
      role: b.enum(['admin', 'user'] as const, 'user'),
      profile: b.json(profileZ),
    });
    const db = await prepareForTest({ users });

    const now = new Date(1700000000000);
    driver.db.prepare('INSERT INTO users (id, createdAt, isActive, role, profile) VALUES (?, ?, ?, ?, ?)').run(['u1', now.getTime(), 1, 0, JSON.stringify({ bio: 'Dev' })]);

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.createdAt}, ${db.users.isActive}, ${db.users.role}, ${db.users.profile} FROM users WHERE ${db.users.createdAt.gte(now)} AND ${db.users.isActive.eq(true)} AND ${db.users.role.eq('admin')}`
      .executeAndTakeFirst(b.z.object({
        id: b.z.id(),
        createdAt: b.z.date(),
        isActive: b.z.boolean(),
        role: b.z.enum(users.role.__meta__.enumValues as any, users.role.__meta__.appDefault as any),
        profile: b.z.json(users.profile.__meta__.jsonSchema as any),
      }));

    expect(row.id).toBe('u1');
    expect(row.isActive).toBe(true);
    expect(row.createdAt.getTime()).toBe(now.getTime());
    expect(row.role).toBe('admin');
    expect(row.profile).toMatchObject({ bio: 'Dev' });
  });

  it('supports IN and BETWEEN and IS NULL/NOT NULL filters', async () => {
    const items = b.table('items', {
      id: b.id(),
      price: b.integer(),
      name: b.text(),
    });
    const db = await prepareForTest({ items });

    driver.db.prepare('INSERT INTO items (id, price, name) VALUES (?, ?, ?)').run(['i1', 10, 'A']);
    driver.db.prepare('INSERT INTO items (id, price, name) VALUES (?, ?, ?)').run(['i2', 20, 'B']);
    driver.db.prepare('INSERT INTO items (id, price, name) VALUES (?, ?, ?)').run(['i3', 30, null]);

    const rows = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 25)} AND ${db.items.id.inArray(['i1','i2'])} AND ${db.items.name.isNull()}`
      .execute(b.z.object({ id: b.z.id(), price: b.z.integer() }));

    expect(rows.length).toBe(0);

    const rows2 = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 30)} AND ${db.items.id.inArray(['i1','i3'])} AND ${db.items.name.isNull()}`
      .execute(b.z.object({ id: b.z.id(), price: b.z.integer() }));

    expect(rows2.length).toBe(1);
    expect(rows2[0].id).toBe('i3');
  });
})
