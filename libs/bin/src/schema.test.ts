import { describe, it, expect } from 'vitest';
import dedent from 'dedent';
import { z } from 'zod';
import { b } from './builder';

describe('schema generation', () => {
  it('built-ins (id, text, integer, real) and an index', () => {
    const users = b.table(
      'users',
      {
        id: b.id(),
        name: b.text(),
        age: b.integer(),
        score: b.real(),
      },
      (t) => [b.index().on(t.name)]
    );

    const db = b.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT,
        age INTEGER,
        score REAL
      );

      CREATE INDEX users_name_idx ON users(name);
    `);
  });

  it('extra types (date, boolean)', () => {
    const extras = b.table('extras', {
      createdAt: b.date(),
      active: b.boolean(),
    });

    const db = b.db({ schema: { extras } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE extras (
        created_at INTEGER,
        active INTEGER
      );
    `);
  });

  it('json(schema) stores schema and emits TEXT', () => {
    const schema = z.object({ a: z.number(), b: z.string().optional() });
    const t = b.table('t', { jsonColumn: b.json(schema) });
    const db = b.db({ schema: { t } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE t (
        json_column TEXT
      );
    `);
    expect(t.__meta__.columns.jsonColumn.jsonSchema).toBe(schema);
  });

  it('constraints/defaults', () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text().notNull().unique().default('Untitled'),
    });

    const db = b.db({ schema: { posts } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL UNIQUE DEFAULT 'Untitled'
      );
    `);
  });

  it('references', () => {
    const users = b.table('users', { id: b.id() });
    const posts = b.table('posts', {
      id: b.id(),
      authorId: b.text().references(() => users.id),
    });

    const db = b.db({ schema: { posts } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        author_id TEXT REFERENCES users(id)
      );
    `);
  });

  it('enum stored as INTEGER', () => {
    const roles = b.table('roles', { role: b.enum(['a', 'b', 'c']) });
    const db = b.db({ schema: { roles } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE roles (
        role INTEGER
      );
    `);
  });

  it('tracks renamed metadata for tables and columns', () => {
    const users = b
      .table('users', {
        id: b.id().renamedFrom('old_id'),
        status: b.enum(['active', 'inactive']).default('active').renamedFrom('old_status'),
      })
      .renamedFrom('old_users');

    expect(users.__meta__.renamedFrom).toBe('old_users');
    expect(users.__meta__.columns.id.renamedFrom).toBe('old_id');
    expect(users.__meta__.columns.status.renamedFrom).toBe('old_status');
  });

  it('indexes: unique and composite', () => {
    const users = b.table(
      'users',
      { id: b.id(), email: b.text(), name: b.text(), age: b.integer() },
      (t) => [b.index().unique().on(t.email), b.index().on(t.name, t.age)]
    );
    const db = b.db({ schema: { users } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        age INTEGER
      );

      CREATE UNIQUE INDEX users_email_idx ON users(email);
      CREATE INDEX users_name_age_idx ON users(name, age);
    `);
  });

  it('generatedAlwaysAs emits GENERATED ALWAYS AS (expr)', () => {
    const t = b.table('t', {
      id: b.id(),
      a: b.integer(),
      b: b.integer().generatedAlwaysAs('a + 1'),
    });
    const db = b.db({ schema: { t } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE t (
        id TEXT PRIMARY KEY,
        a INTEGER,
        b INTEGER GENERATED ALWAYS AS (a + 1) VIRTUAL
      );
    `);
  });
  it('tables are accessible on db instance', () => {
    const users = b.table('users', { id: b.id(), name: b.text() });
    const posts = b.table('posts', { id: b.id(), title: b.text() });
    const db = b.db({ schema: { users, posts } });

    expect(db.users).toBeDefined();
    expect(db.posts).toBeDefined();
  });

  it('single column primary key constraint', () => {
    const users = b.table(
      'users',
      {
        id: b.text(),
        name: b.text(),
      },
      undefined,
      (t) => [b.primaryKey(t.id)]
    );

    const db = b.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT,
        name TEXT,
        PRIMARY KEY (id)
      );
    `);
  });

  it('multi-column primary key constraint', () => {
    const userRoles = b.table(
      'user_roles',
      {
        userId: b.text(),
        roleId: b.text(),
        assignedAt: b.date(),
      },
      undefined,
      (t) => [b.primaryKey(t.userId, t.roleId)]
    );

    const db = b.db({ schema: { userRoles } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE user_roles (
        user_id TEXT,
        role_id TEXT,
        assigned_at INTEGER,
        PRIMARY KEY (user_id, role_id)
      );
    `);
  });

  it('single column unique constraint', () => {
    const users = b.table(
      'users',
      {
        id: b.id(),
        email: b.text(),
        name: b.text(),
      },
      undefined,
      (t) => [b.unique(t.email)]
    );

    const db = b.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        UNIQUE (email)
      );
    `);
  });

  it('multi-column unique constraint', () => {
    const users = b.table(
      'users',
      {
        id: b.id(),
        firstName: b.text(),
        lastName: b.text(),
        email: b.text(),
      },
      undefined,
      (t) => [b.unique(t.firstName, t.lastName)]
    );

    const db = b.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        UNIQUE (first_name, last_name)
      );
    `);
  });

  it('multiple constraints of different types', () => {
    const products = b.table(
      'products',
      {
        id: b.id(),
        sku: b.text(),
        barcode: b.text(),
        name: b.text(),
        category: b.text(),
      },
      undefined,
      (t) => [b.unique(t.sku), b.unique(t.barcode), b.unique(t.name, t.category)]
    );

    const db = b.db({ schema: { products } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        sku TEXT,
        barcode TEXT,
        name TEXT,
        category TEXT,
        UNIQUE (sku),
        UNIQUE (barcode),
        UNIQUE (name, category)
      );
    `);
  });

  it('constraints with indexes', () => {
    const users = b.table(
      'users',
      {
        id: b.text(),
        email: b.text(),
        name: b.text(),
        age: b.integer(),
      },
      (t) => [b.index().on(t.name), b.index().on(t.age)],
      (t) => [b.primaryKey(t.id), b.unique(t.email)]
    );

    const db = b.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT,
        email TEXT,
        name TEXT,
        age INTEGER,
        PRIMARY KEY (id),
        UNIQUE (email)
      );

      CREATE INDEX users_age_idx ON users(age);
      CREATE INDEX users_name_idx ON users(name);
    `);
  });

  it('constraint builder validates empty columns', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    expect(() => b.primaryKey()).toThrow('primaryKey constraint requires at least one column');
    expect(() => b.unique()).toThrow('unique constraint requires at least one column');
  });

  it('constraint builder validates duplicate columns', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    expect(() => b.primaryKey(users.id, users.id)).toThrow('primaryKey constraint columns must be unique');
    expect(() => b.unique(users.name, users.name)).toThrow('unique constraint columns must be unique');
  });
});
