import { describe, it, expect, beforeEach } from 'vitest';
import { b } from './builder';
import { BinNodeDriver, BinTursoDriver } from './bin-node-driver';
import { z } from 'zod';
import type { Table } from './table';
import type { Db } from './db';
import { sql } from './utils/sql';

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
});

describe('update', () => {
  it('should update data with WHERE clause', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer().default(0),
      email: b.text(),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insert({
      id: 'user-1',
      name: 'John Doe',
      email: 'john@example.com',
      age: 25,
    });

    await users.insert({
      id: 'user-2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      age: 30,
    });

    // Update user-1's age and name
    await users.update({
      data: { name: 'Johnny Doe', age: 26 },
      where: sql`${users.id.eq('user-1')}`,
    });

    // Verify user-1 was updated
    const updatedUser = driver.db.prepare('SELECT id, name, age FROM users WHERE id = ?').get(['user-1']);
    expect(updatedUser).toMatchObject({ id: 'user-1', name: 'Johnny Doe', age: 26 });

    // Verify user-2 was not affected
    const unchangedUser = driver.db.prepare('SELECT id, name, age FROM users WHERE id = ?').get(['user-2']);
    expect(unchangedUser).toMatchObject({ id: 'user-2', name: 'Jane Smith', age: 30 });
  });

  it('should handle different data types in updates', async () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text(),
      published: b.boolean().default(false),
      views: b.integer().default(0),
    });

    const db = await prepareForTest({ posts });

    // Insert test data
    await posts.insert({
      id: 'post-1',
      title: 'Draft Post',
      published: false,
      views: 5,
    });

    // Update to publish the post
    await posts.update({
      data: { title: 'Published Post', published: true, views: 100 },
      where: sql`${posts.id.eq('post-1')}`,
    });

    // Verify update (boolean stored as integer)
    const updatedPost = driver.db.prepare('SELECT id, title, published, views FROM posts WHERE id = ?').get(['post-1']);
    expect(updatedPost).toMatchObject({
      id: 'post-1',
      title: 'Published Post',
      published: 1, // boolean true stored as 1
      views: 100
    });
  });

  it('should apply $onUpdateFn when updating', async () => {
    let updateCallCount = 0;
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      updatedAt: b.date().$onUpdateFn(() => {
        updateCallCount++;
        return new Date(1700000000000); // Fixed timestamp for testing
      }),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insert({
      id: 'user-1',
      name: 'John Doe',
      updatedAt: new Date(1600000000000), // Earlier timestamp
    });

    // Update user
    await users.update({
      data: { name: 'Johnny Doe' },
      where: sql`${users.id.eq('user-1')}`,
    });

    // Verify onUpdate function was called
    expect(updateCallCount).toBe(1);

    // Verify updatedAt was updated to the onUpdate value
    const updatedUser = driver.db.prepare('SELECT id, name, updatedAt FROM users WHERE id = ?').get(['user-1']);
    expect(updatedUser).toMatchObject({
      id: 'user-1',
      name: 'Johnny Doe',
      updatedAt: 1700000000000 // The fixed timestamp from onUpdate
    });
  });

  it('should update multiple rows with WHERE clause', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
      status: b.text().default('active'),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insertMany([
      { id: 'user-1', name: 'John', age: 25, status: 'active' },
      { id: 'user-2', name: 'Jane', age: 30, status: 'active' },
      { id: 'user-3', name: 'Bob', age: 35, status: 'inactive' },
    ]);

    // Update all active users older than 28
    await users.update({
      data: { status: 'senior' },
      where: sql`${users.age.gte(28)} AND ${users.status.eq('active')}`,
    });

    // Verify only user-2 was updated
    const allUsers = driver.db.prepare('SELECT id, status FROM users ORDER BY id').all();
    expect(allUsers).toMatchObject([
      { id: 'user-1', status: 'active' }, // age 25, not updated
      { id: 'user-2', status: 'senior' }, // age 30, updated
      { id: 'user-3', status: 'inactive' }, // inactive, not updated
    ]);
  });

  it('should throw error when no columns to update', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    await users.insert({
      id: 'user-1',
      name: 'John',
    });

    // Try to update with no data
    await expect(users.update({
      data: {},
      where: sql`${users.id.eq('user-1')}`,
    })).rejects.toThrow('No columns to update');
  });

  it('should parse UPDATE query for security analysis', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = await prepareForTest({ users });

    await users.insert({
      id: 'user-1',
      name: 'John',
      age: 25,
    });

    // This should not throw - security parsing should succeed for valid UPDATE
    await expect(users.update({
      data: { name: 'Johnny', age: 26 },
      where: sql`${users.id.eq('user-1')}`,
    })).resolves.not.toThrow();

    // Verify the update actually worked
    const updatedUser = driver.db.prepare('SELECT id, name, age FROM users WHERE id = ?').get(['user-1']);
    expect(updatedUser).toMatchObject({ id: 'user-1', name: 'Johnny', age: 26 });
  });

  it('should handle malformed UPDATE queries in security parsing', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

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
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insertMany([
      { id: 'user-1', name: 'John Doe', age: 25 },
      { id: 'user-2', name: 'Jane Smith', age: 30 },
      { id: 'user-3', name: 'Bob Johnson', age: 35 },
    ]);

    // Delete user-2
    await users.delete({
      where: sql`${users.id.eq('user-2')}`,
    });

    // Verify user-2 was deleted
    const remainingUsers = driver.db.prepare('SELECT id, name FROM users ORDER BY id').all();
    expect(remainingUsers).toMatchObject([
      { id: 'user-1', name: 'John Doe' },
      { id: 'user-3', name: 'Bob Johnson' },
    ]);
  });

  it('should delete multiple rows with WHERE clause', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
      status: b.text().default('active'),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insertMany([
      { id: 'user-1', name: 'John', age: 25, status: 'active' },
      { id: 'user-2', name: 'Jane', age: 30, status: 'inactive' },
      { id: 'user-3', name: 'Bob', age: 35, status: 'inactive' },
      { id: 'user-4', name: 'Alice', age: 28, status: 'active' },
    ]);

    // Delete all inactive users
    await users.delete({
      where: sql`${users.status.eq('inactive')}`,
    });

    // Verify only active users remain
    const remainingUsers = driver.db.prepare('SELECT id, name, status FROM users ORDER BY id').all();
    expect(remainingUsers).toMatchObject([
      { id: 'user-1', name: 'John', status: 'active' },
      { id: 'user-4', name: 'Alice', status: 'active' },
    ]);
  });

  it('should delete with complex WHERE conditions', async () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text(),
      views: b.integer().default(0),
      published: b.boolean().default(false),
    });

    const db = await prepareForTest({ posts });

    // Insert test data
    await posts.insertMany([
      { id: 'post-1', title: 'Draft 1', views: 5, published: false },
      { id: 'post-2', title: 'Published 1', views: 100, published: true },
      { id: 'post-3', title: 'Draft 2', views: 2, published: false },
      { id: 'post-4', title: 'Published 2', views: 50, published: true },
    ]);

    // Delete unpublished posts with low views
    await posts.delete({
      where: sql`${posts.published.eq(false)} AND ${posts.views.lt(10)}`,
    });

    // Verify only published posts and high-view drafts remain
    const remainingPosts = driver.db.prepare('SELECT id, title, views, published FROM posts ORDER BY id').all();
    expect(remainingPosts).toMatchObject([
      { id: 'post-2', title: 'Published 1', views: 100, published: 1 },
      { id: 'post-4', title: 'Published 2', views: 50, published: 1 },
    ]);
  });

  it('should handle delete with IN clause', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    // Insert test data
    await users.insertMany([
      { id: 'user-1', name: 'John' },
      { id: 'user-2', name: 'Jane' },
      { id: 'user-3', name: 'Bob' },
      { id: 'user-4', name: 'Alice' },
    ]);

    // Delete specific users by ID
    await users.delete({
      where: sql`${users.id.inArray(['user-1', 'user-3'])}`,
    });

    // Verify only user-2 and user-4 remain
    const remainingUsers = driver.db.prepare('SELECT id, name FROM users ORDER BY id').all();
    expect(remainingUsers).toMatchObject([
      { id: 'user-2', name: 'Jane' },
      { id: 'user-4', name: 'Alice' },
    ]);
  });

  it('should parse DELETE query for security analysis', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    await users.insert({
      id: 'user-1',
      name: 'John',
    });

    // This should not throw - security parsing should succeed for valid DELETE
    await expect(users.delete({
      where: sql`${users.id.eq('user-1')}`,
    })).resolves.not.toThrow();

    // Verify the delete actually worked
    const remainingUsers = driver.db.prepare('SELECT id FROM users').all();
    expect(remainingUsers).toHaveLength(0);
  });

  it('should handle malformed DELETE queries in security parsing', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    // Create a malformed RawSql object that should trigger parsing errors
    const malformedSql: any = {
      query: 'id = ? AND INVALID SYNTAX',
      params: ['user-1']
    };

    // The security parsing should catch malformed SQL
    await expect(users.delete({
      where: malformedSql,
    })).rejects.toThrow();
  });

  it('should delete no rows when WHERE clause matches nothing', async () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await prepareForTest({ users });

    await users.insertMany([
      { id: 'user-1', name: 'John' },
      { id: 'user-2', name: 'Jane' },
    ]);

    // Delete non-existent user
    await users.delete({
      where: sql`${users.id.eq('user-999')}`,
    });

    // Verify no users were deleted
    const remainingUsers = driver.db.prepare('SELECT id FROM users').all();
    expect(remainingUsers).toHaveLength(2);
  });
});
