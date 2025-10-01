import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ShallowPrettify, Expect, Equal } from '../utils/utils';
import { o } from './builder';

describe('table.make()', () => {
  describe('basic functionality', () => {
    it('creates object with app defaults when no overrides provided', () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().default('Anonymous'),
        age: o.integer().default(18),
        score: o.real(),
        isActive: o.boolean().default(true),
      });

      const result = users.make();

      expect(result).toMatchObject({
        name: 'Anonymous',
        age: 18,
        isActive: true,
      });

      type Received = ShallowPrettify<typeof result>;
      type Expected = {
        id: string;
        name: string;
        age: number;
        score: number | undefined;
        isActive: boolean;
      }
      type _Test = Expect<Equal<Received, Expected>>;
    });

    it('uses overrides when provided, falls back to defaults otherwise', () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().default('Anonymous'),
        age: o.integer().default(18),
        email: o.text(),
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
      const posts = o.table('posts', {
        id: o.id(),
        title: o.text(),
        createdAt: o.date().$defaultFn(() => new Date('2024-01-01')),
        updatedAt: o.date().$defaultFn(() => new Date('2024-01-02')),
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
      const posts = o.table('posts', {
        id: o.id(),
        createdAt: o.date().$defaultFn(() => new Date('2024-01-01')),
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
      const users = o.table('users', {
        id: o.id(),
        role: o.enum(['admin', 'user', 'guest']).default('user'),
        status: o.enum(['active', 'inactive']).default('active'),
      });

      const result = users.make();

      expect(result).toMatchObject({
        role: 'user',
      });
    });

    it('fills implicit defaults for common column types', () => {
      const profileSchema = z.object({ theme: z.string(), tags: z.array(z.string()) });
      const users = o.table('users', {
        id: o.id(),
        name: o.text(),
        age: o.integer(),
        score: o.real(),
        isActive: o.boolean(),
        createdAt: o.date(),
        role: o.enum(['admin', 'user']),
        settings: o.json(profileSchema),
      });

      const result = users.make();

      expect(result).toMatchObject({
        name: '',
        age: 0,
        score: 0,
        isActive: false,
        role: 'admin',
        settings: { theme: '', tags: [] },
      });
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('handles json columns', () => {
      const schema = z.object({ count: z.number(), tags: z.array(z.string()) });
      const posts = o.table('posts', {
        id: o.id(),
        metadata: o.json(schema),
      });

      const result = posts.make({
        metadata: { count: 5, tags: ['test'] },
      });

      expect(result).toMatchObject({
        metadata: { count: 5, tags: ['test'] },
      });
    });

    it('handles boolean columns', () => {
      const settings = o.table('settings', {
        id: o.id(),
        enabled: o.boolean().default(false),
        visible: o.boolean(),
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
      const users = o.table('users', {
        id: o.id(),
        firstName: o.text(),
        lastName: o.text(),
        fullName: o.text().generatedAlwaysAs('firstName || " " || lastName'),
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
      const users = o.table('users', { id: o.id() });
      const posts = o.table('posts', {
        id: o.id(),
        title: o.text(),
        authorId: o.text().references(() => users.id),
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
      const empty = o.table('empty', {});
      const result = empty.make();
      expect(result).toEqual({});
    });

    it('handles null defaults', () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().default(null),
        description: o.text(),
      });

      const result = users.make();

      expect(result).toMatchObject({
        name: null,
      });
    });

    it('handles complex mixed scenario', () => {
      const users = o.table('users', {
        id: o.id(),
        name: o.text().notNull().default('Anonymous'),
        email: o.text().unique(),
        age: o.integer().default(18),
        role: o.enum(['admin', 'user']).default('user'),
        isActive: o.boolean().default(true),
        createdAt: o.date().$defaultFn(() => new Date('2024-01-01')),
        profile: o.json(z.object({ bio: z.string() })),
        fullName: o.text().generatedAlwaysAs('name'),
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
