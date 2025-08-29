import { describe, it, expect, beforeEach } from 'vitest';
import { b } from './builder';
import { BinNodeDriver } from './bin-node-driver';
import { z } from 'zod';

let driver: BinNodeDriver;

beforeEach(() => {
  driver = new BinNodeDriver(':memory:');
});

// describe('insert', () => {
//   it('should insert data and verify via query', async () => {
//     // Create a test table schema
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text(),
//       age: b.integer().default(0),
//       email: b.text(),
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     const insertResult = await users.insert({
//       data: {
//         id: 'test-123',
//         name: 'John Doe',
//         email: 'john@example.com',
//         age: 20
//       }
//     });

//     // Verify data was inserted by querying the database
//     const queryResult = driver.run({
//       query: 'SELECT * FROM users WHERE id = ?',
//       params: ['test-123']
//     });

//     expect(insertResult).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should handle different data types', async () => {
//     const posts = b.table('posts', {
//       id: b.id(),
//       title: b.text(),
//       published: b.boolean().default(false),
//       views: b.integer().default(0)
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { posts } });
//     await db._connectDriver(driver);

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     const result = await posts.insert({
//       data: {
//         id: 'post-123',
//         title: 'Test Post',
//         published: true,
//         views: 42
//       }
//     });

//     // Verify data with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT * FROM posts WHERE id = ?',
//       params: ['post-123']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should work with returning option', async () => {
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text()
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     const result = await users.insert({
//       data: { id: 'user-123', name: 'Alice' },
//       returning: '*'
//     });

//     // Verify with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT COUNT(*) as count FROM users WHERE name = ?',
//       params: ['Alice']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should maintain type safety', async () => {
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text(),
//       age: b.integer()
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     // This should compile successfully - verifies type safety
//     const result = await users.insert({
//       data: {
//         id: 'type-safe-test',
//         name: 'Type Safe User',
//         age: 30
//       }
//     });

//     // Verify with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT name, age FROM users WHERE id = ?',
//       params: ['type-safe-test']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });
// });

describe('select', () => {
  it('executes simple select via db.query and parses with zod', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = b.db({ schema: { users } });
    await db._connectDriver(driver);
    driver.exec(db.getSchemaDefinition());

    // Seed some rows directly
    driver.run({ query: 'INSERT INTO users (id, name, age) VALUES (?, ?, ?)', params: ['u1', 'Alice', 30] });
    driver.run({ query: 'INSERT INTO users (id, name, age) VALUES (?, ?, ?)', params: ['u2', 'Bob', 25] });

    const rows = await db
      .query`SELECT ${db.users.id}, ${db.users.name}, ${db.users.age} FROM users WHERE ${db.users.age.gte(25)}`
      .execute(z.object({ id: b.z.id(), name: b.z.text(), age: b.z.integer() }));

    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ id: 'u1', name: 'Alice', age: 30 });
  });

  it('executeAndTakeFirst returns a single parsed row', async () => {
    const users = b.table('users', { id: b.id(), name: b.text() });
    const db = b.db({ schema: { users } });
    await db._connectDriver(driver);
    driver.exec(db.getSchemaDefinition());

    driver.run({ query: 'INSERT INTO users (id, name) VALUES (?, ?)', params: ['u1', 'Alice'] });

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.name} FROM users WHERE ${db.users.id.eq('u1')}`
      .executeAndTakeFirst(z.object({ id: b.z.id(), name: b.z.text() }));

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
    const db = b.db({ schema: { users } });
    await db._connectDriver(driver);
    driver.exec(db.getSchemaDefinition());

    const now = new Date(1700000000000);
    driver.run({ query: 'INSERT INTO users (id, createdAt, isActive, role, profile) VALUES (?, ?, ?, ?, ?)', params: ['u1', now.getTime(), 1, 0, JSON.stringify({ bio: 'Dev' })] });

    const row = await db
      .query`SELECT ${db.users.id}, ${db.users.createdAt}, ${db.users.isActive}, ${db.users.role}, ${db.users.profile} FROM users WHERE ${db.users.createdAt.gte(now)} AND ${db.users.isActive.eq(true)} AND ${db.users.role.eq('admin')}`
      .executeAndTakeFirst(z.object({
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
    const db = b.db({ schema: { items } });
    await db._connectDriver(driver);
    driver.exec(db.getSchemaDefinition());

    driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: ['i1', 10, 'A'] });
    driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: ['i2', 20, 'B'] });
    driver.run({ query: 'INSERT INTO items (id, price, name) VALUES (?, ?, ?)', params: ['i3', 30, null] });

    const rows = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 25)} AND ${db.items.id.inArray(['i1','i2'])} AND ${db.items.name.isNull()}`
      .execute(z.object({ id: b.z.id(), price: b.z.integer() }));

    expect(rows.length).toBe(0);

    const rows2 = await db
      .query`SELECT ${db.items.id}, ${db.items.price} FROM items WHERE ${db.items.price.between(10, 30)} AND ${db.items.id.inArray(['i1','i3'])} AND ${db.items.name.isNull()}`
      .execute(z.object({ id: b.z.id(), price: b.z.integer() }));

    expect(rows2.length).toBe(1);
    expect(rows2[0].id).toBe('i3');
  });
})
