import { describe, it, expect } from 'vitest';
import dedent from 'dedent';
import { b } from '../builder';

describe('schema generation - consolidated', () => {
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

  it('extra types (date, json, boolean)', () => {
    const extras = b.table('extras', {
      createdAt: b.date(),
      meta: b.json(),
      active: b.boolean(),
    });

    const db = b.db({ schema: { extras } });

    expect(db.getSchemaDefinition()).toBe(dedent`
      CREATE TABLE extras (
        createdAt INTEGER,
        meta TEXT,
        active INTEGER
      );
    `);
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
        authorId TEXT REFERENCES users(id)
      );
    `);
  });

  it('enum stored as INTEGER', () => {
    const roles = b.table('roles', { role: b.enum(['a', 'b', 'c'] as const, 'a') });
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
});
