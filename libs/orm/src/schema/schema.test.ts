import { describe, it, expect } from 'vitest';
import dedent from 'dedent';
import { s } from '@w/schema';
import { o } from './builder';

describe('schema generation', () => {
  it('built-ins (id, text, integer, real) and an index', () => {
    const users = o.table(
      'users',
      {
        id: o.id(),
        name: o.text(),
        age: o.integer(),
        score: o.real(),
      },
      (t) => [o.index().on(t.name)]
    );

    const db = o.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id BLOB PRIMARY KEY,
        name TEXT,
        age INTEGER,
        score REAL
      );

      CREATE INDEX users_name_idx ON users(name);
    `);
  });

  it('extra types (date, boolean)', () => {
    const extras = o.table('extras', {
      createdAt: o.date(),
      active: o.boolean(),
    });

    const db = o.db({ schema: { extras } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE extras (
        created_at INTEGER,
        active INTEGER
      );
    `);
  });

  it('json(schema) stores schema and emits TEXT', () => {
    const schema = s.object({ a: s.number(), b: s.string().optional() });
    const t = o.table('t', { jsonColumn: o.json(schema) });
    const db = o.db({ schema: { t } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE t (
        json_column TEXT
      );
    `);
    expect(t.__meta__.columns.jsonColumn.jsonSchema).toBe(schema);
  });

  it('constraints/defaults', () => {
    const posts = o.table('posts', {
      id: o.id(),
      title: o.text().notNull().unique().default('Untitled'),
    });

    const db = o.db({ schema: { posts } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE posts (
        id BLOB PRIMARY KEY,
        title TEXT NOT NULL UNIQUE DEFAULT 'Untitled'
      );
    `);
  });

  it('references', () => {
    const users = o.table('users', { id: o.id() });
    const posts = o.table('posts', {
      id: o.id(),
      authorId: o.text().references(() => users.id),
    });

    const db = o.db({ schema: { posts } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE posts (
        id BLOB PRIMARY KEY,
        author_id TEXT REFERENCES users(id)
      );
    `);
  });

  it('enum stored as INTEGER', () => {
    const roles = o.table('roles', { role: o.enum(['a', 'b', 'c']) });
    const db = o.db({ schema: { roles } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE roles (
        role INTEGER
      );
    `);
  });

  it('tracks renamed metadata for tables and columns', () => {
    const users = o
      .table('users', {
        id: o.id().renamedFrom('old_id'),
        status: o.enum(['active', 'inactive']).default('active').renamedFrom('old_status'),
      })
      .renamedFrom('old_users');

    expect(users.__meta__.renamedFrom).toBe('old_users');
    expect(users.__meta__.columns.id.renamedFrom).toBe('old_id');
    expect(users.__meta__.columns.status.renamedFrom).toBe('old_status');
  });

  it('indexes: unique and composite', () => {
    const users = o.table(
      'users',
      { id: o.id(), email: o.text(), name: o.text(), age: o.integer() },
      (t) => [o.index().unique().on(t.email), o.index().on(t.name, t.age)]
    );
    const db = o.db({ schema: { users } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id BLOB PRIMARY KEY,
        email TEXT,
        name TEXT,
        age INTEGER
      );

      CREATE UNIQUE INDEX users_email_idx ON users(email);
      CREATE INDEX users_name_age_idx ON users(name, age);
    `);
  });

  it('generatedAlwaysAs emits GENERATED ALWAYS AS (expr)', () => {
    const t = o.table('t', {
      id: o.id(),
      a: o.integer(),
      b: o.integer().generatedAlwaysAs('a + 1'),
    });
    const db = o.db({ schema: { t } });
    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE t (
        id BLOB PRIMARY KEY,
        a INTEGER,
        b INTEGER GENERATED ALWAYS AS (a + 1) VIRTUAL
      );
    `);
  });
  it('tables are accessible on db instance', () => {
    const users = o.table('users', { id: o.id(), name: o.text() });
    const posts = o.table('posts', { id: o.id(), title: o.text() });
    const db = o.db({ schema: { users, posts } });

    expect(db.users).toBeDefined();
    expect(db.posts).toBeDefined();
  });

  it('single column primary key constraint', () => {
    const users = o.table(
      'users',
      {
        id: o.text(),
        name: o.text(),
      },
      undefined,
      (t) => [o.primaryKey(t.id)]
    );

    const db = o.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id TEXT,
        name TEXT,
        PRIMARY KEY (id)
      );
    `);
  });

  it('multi-column primary key constraint', () => {
    const userRoles = o.table(
      'user_roles',
      {
        userId: o.text(),
        roleId: o.text(),
        assignedAt: o.date(),
      },
      undefined,
      (t) => [o.primaryKey(t.userId, t.roleId)]
    );

    const db = o.db({ schema: { userRoles } });

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
    const users = o.table(
      'users',
      {
        id: o.id(),
        email: o.text(),
        name: o.text(),
      },
      undefined,
      (t) => [o.unique(t.email)]
    );

    const db = o.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id BLOB PRIMARY KEY,
        email TEXT,
        name TEXT,
        UNIQUE (email)
      );
    `);
  });

  it('multi-column unique constraint', () => {
    const users = o.table(
      'users',
      {
        id: o.id(),
        firstName: o.text(),
        lastName: o.text(),
        email: o.text(),
      },
      undefined,
      (t) => [o.unique(t.firstName, t.lastName)]
    );

    const db = o.db({ schema: { users } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE users (
        id BLOB PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        UNIQUE (first_name, last_name)
      );
    `);
  });

  it('multiple constraints of different types', () => {
    const products = o.table(
      'products',
      {
        id: o.id(),
        sku: o.text(),
        barcode: o.text(),
        name: o.text(),
        category: o.text(),
      },
      undefined,
      (t) => [o.unique(t.sku), o.unique(t.barcode), o.unique(t.name, t.category)]
    );

    const db = o.db({ schema: { products } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE products (
        id BLOB PRIMARY KEY,
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
    const users = o.table(
      'users',
      {
        id: o.text(),
        email: o.text(),
        name: o.text(),
        age: o.integer(),
      },
      (t) => [o.index().on(t.name), o.index().on(t.age)],
      (t) => [o.primaryKey(t.id), o.unique(t.email)]
    );

    const db = o.db({ schema: { users } });

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
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    expect(() => o.primaryKey()).toThrow('primaryKey constraint requires at least one column');
    expect(() => o.unique()).toThrow('unique constraint requires at least one column');
  });

  it('constraint builder validates duplicate columns', () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    });

    expect(() => o.primaryKey(users.id, users.id)).toThrow('primaryKey constraint columns must be unique');
    expect(() => o.unique(users.name, users.name)).toThrow('unique constraint columns must be unique');
  });
});
