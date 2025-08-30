import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { b } from './builder';

export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
export type ShallowPrettify<T> = { [K in keyof T]: T[K] } & {}
// TODO: b.text().default('Anonymous') - should update app default
// TODO: add $defaultFn
// TODO: add encode decode functions, when default is called they should properly process it

// use ShallowPrettify if necessary to fix errors in Expect<Equal calls

describe('table.make()', () => {
  describe('basic functionality', () => {
    it('creates object with app defaults when no overrides provided', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().default('Anonymous'),
        age: b.integer().default(18),
        score: b.real(),
        isActive: b.boolean().default(true),
      });

      const result = users.make({});

      expect(result).toMatchObject({
        name: 'Anonymous',
        age: 18,
        isActive: true,
      });
    });

    it('uses overrides when provided, falls back to defaults otherwise', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().default('Anonymous'),
        age: b.integer().default(18),
        email: b.text(),
      });

      const result = users.make({
        name: 'John',
        age: 25,
      });

      expect(result).toMatchObject({
        name: 'John',
        age: 25,
      });
    });

    it('handles $defaultFn functions for app defaults', () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text(),
        createdAt: b.date().$defaultFn(() => new Date('2024-01-01')),
        updatedAt: b.date().$defaultFn(() => new Date('2024-01-02')),
      });

      const result = posts.make({
        title: 'Test Post',
      });

      expect(result).toMatchObject({
        title: 'Test Post',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });
    });

    it('overrides default functions when explicit values provided', () => {
      const posts = b.table('posts', {
        id: b.id(),
        createdAt: b.date().$defaultFn(() => new Date('2024-01-01')),
      });

      const customDate = new Date('2023-12-25');
      const result = posts.make({
        createdAt: customDate,
      });

      expect(result.createdAt).toBe(customDate);
    });
  });

  describe('column types handling', () => {
    it('handles enum columns with defaults', () => {
      const users = b.table('users', {
        id: b.id(),
        role: b.enum(['admin', 'user', 'guest'], 'user'),
        status: b.enum(['active', 'inactive'], 'active'),
      });

      const result = users.make({});

      expect(result).toMatchObject({
        role: 'user',
      });
    });

    it('handles json columns', () => {
      const schema = z.object({ count: z.number(), tags: z.array(z.string()) });
      const posts = b.table('posts', {
        id: b.id(),
        metadata: b.json(schema),
      });

      const result = posts.make({
        metadata: { count: 5, tags: ['test'] },
      });

      expect(result).toMatchObject({
        metadata: { count: 5, tags: ['test'] },
      });
    });

    it('handles boolean columns', () => {
      const settings = b.table('settings', {
        id: b.id(),
        enabled: b.boolean().default(false),
        visible: b.boolean(),
      });

      const result = settings.make({
        enabled: true,
      });

      expect(result).toMatchObject({
        enabled: true,
      });
    });
  });

  describe('constraints and special columns', () => {
    it('ignores virtual/generated columns', () => {
      const users = b.table('users', {
        id: b.id(),
        firstName: b.text(),
        lastName: b.text(),
        fullName: b.text().generatedAlwaysAs('firstName || " " || lastName'),
      });

      const result = users.make({
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(result).toMatchObject({
        firstName: 'John',
        lastName: 'Doe',
      });
      expect(result).not.toHaveProperty('fullName');
    });

    it('handles foreign key references', () => {
      const users = b.table('users', { id: b.id() });
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text(),
        authorId: b.text().references(() => users.id),
      });

      const result = posts.make({
        title: 'Test Post',
        authorId: 'user-123',
      });

      expect(result).toMatchObject({
        title: 'Test Post',
        authorId: 'user-123',
      });
    });
  });

  describe('edge cases', () => {
    it('handles empty table schema', () => {
      const empty = b.table('empty', {});
      const result = empty.make({});
      expect(result).toEqual({});
    });

    it('handles null defaults', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().default(null),
        description: b.text(),
      });

      const result = users.make({});

      expect(result).toMatchObject({
        name: null,
      });
    });

    it('handles complex mixed scenario', () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull().default('Anonymous'),
        email: b.text().unique(),
        age: b.integer().default(18),
        role: b.enum(['admin', 'user'], 'user'),
        isActive: b.boolean().default(true),
        createdAt: b.date().$defaultFn(() => new Date('2024-01-01')),
        profile: b.json(z.object({ bio: z.string() })),
        fullName: b.text().generatedAlwaysAs('name'),
      });

      const result = users.make({
        name: 'Alice',
        email: 'alice@example.com',
        profile: { bio: 'Developer' },
      });

      expect(result).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com',
        age: 18,
        role: 'user',
        isActive: true,
        createdAt: new Date('2024-01-01'),
        profile: { bio: 'Developer' },
      });
      expect(result).not.toHaveProperty('fullName');
    });
  });
});

describe('table.make() type _tests', () => {
  it('returns correct type for basic table', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
      age: b.integer(),
    });

    const result = users.make({});

    type Expected = {
      id: string;
      name: string;
      age: number;
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });

  it('handles defaults correctly in types', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text().default('Anonymous'),
      age: b.integer(),
      isActive: b.boolean().default(true),
    });

    const result = users.make({});

    type Expected = {
      id: string;
      name: string;
      age: number;
      isActive: boolean;
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });

  it('handles partial overrides correctly', () => {
    const users = b.table('users', {
      id: b.id(),
      name: b.text().default('Anonymous'),
      age: b.integer(),
      email: b.text(),
    });

    type PartialOverrides = Partial<{
      id: string;
      name: string;
      age: number;
      email: string;
    }>;

    const overrides: PartialOverrides = { name: 'John' };
    const result = users.make(overrides);

    type Expected = {
      id: string;
      name: string;
      age: number;
      email: string;
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });

  it('excludes virtual columns from result type', () => {
    const users = b.table('users', {
      id: b.id(),
      firstName: b.text(),
      fullName: b.text().generatedAlwaysAs('firstName'),
    });

    const result = users.make({});

    type Expected = {
      id: string;
      firstName: string;
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });

  it('handles enum types correctly', () => {
    const users = b.table('users', {
      id: b.id(),
      role: b.enum(['admin', 'user'], 'user'),
      status: b.enum(['active', 'inactive'], 'active'),
    });

    const result = users.make({});

    type Expected = {
      id: string;
      role: 'admin' | 'user';
      status: 'active' | 'inactive';
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });

  it('handles json types correctly', () => {
    const schema = z.object({ count: z.number() });
    const posts = b.table('posts', {
      id: b.id(),
      metadata: b.json(schema),
    });

    const result = posts.make({});

    type Expected = {
      id: string;
      metadata: { count: number } | undefined;
    };

    type _Test = Expect<Equal<typeof result, Expected>>;
  });
});
