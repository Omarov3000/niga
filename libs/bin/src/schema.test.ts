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
        b INTEGER GENERATED ALWAYS AS (a + 1)
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
});
