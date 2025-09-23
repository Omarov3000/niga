import { describe, it, expect } from 'vitest';
import z from 'zod';
import { b } from '../builder';
import { Expect, Equal } from '../utils';
import { makeInsertSchema, makeSelectSchema } from './make-zod-schema';

describe('makeInsertSchema()', () => {
  it('supports every column type our builder exposes', () => {
    const profileSchema = z.object({ theme: z.string(), tags: z.array(z.string()) });

    const users = b.table('users', {
      id: b.id(),
      name: b.text().notNull(),
      age: b.integer().default(18),
      salary: b.real().$defaultFn(() => 1000),
      height: b.real(),
      isActive: b.boolean(),
      createdAt: b.date(),
      settings: b.json(profileSchema),
      role: b.enum(['admin', 'user', 'guest'], 'guest').notNull(),
    });

    const schema = makeInsertSchema(users);
    const result = schema.parse({
      id: 'custom-id',
      name: 'John Doe',
      age: 30,
      salary: 1100,
      height: 180,
      isActive: 1,
      createdAt: 1_700_000_000_000,
      settings: '{"theme":"dark","tags":["a","b"]}',
      role: 'user',
    });

    expect(result).toMatchObject({
      id: 'custom-id',
      name: 'John Doe',
      age: 30,
      salary: 1100,
      height: 180,
      isActive: true,
      createdAt: expect.any(Date),
      settings: {
        theme: 'dark',
        tags: ['a', 'b'],
      },
      role: 'user',
    });

    type Received = z.infer<typeof schema>;
    type Expected = {
      id?: string | undefined;
      name: string;
      age?: number | undefined;
      salary?: number | undefined;
      height?: number | undefined;
      isActive?: boolean | undefined;
      createdAt?: Date | undefined;
      settings?: {
        theme: string;
        tags: string[];
      } | undefined;
      role: 'admin' | 'user' | 'guest';
    };
    type _Test = Expect<Equal<Received, Expected>>;
  });
});

describe('makeSelectSchema()', () => {
  it('decodes database rows across column kinds', () => {
    const profileSchema = z.object({ theme: z.string(), tags: z.array(z.string()) });

    const users = b.table('users', {
      id: b.id(),
      name: b.text().notNull(),
      age: b.integer(),
      salary: b.real().$defaultFn(() => 1000),
      height: b.real(),
      isActive: b.boolean(),
      createdAt: b.date().notNull(),
      settings: b.json(profileSchema),
      role: b.enum(['admin', 'user', 'guest'], 'guest').notNull(),
    });

    const schema = makeSelectSchema(users);

    const fullRow = schema.parse({
      id: 'db-id-1',
      name: 'John Doe',
      age: 30,
      salary: 1250,
      height: 181.5,
      isActive: 1,
      createdAt: 1_700_000_000_000,
      settings: '{"theme":"dark","tags":["a","b"]}',
      role: 2,
    });

    expect(fullRow).toMatchObject({
      id: 'db-id-1',
      name: 'John Doe',
      age: 30,
      salary: 1250,
      height: 181.5,
      isActive: true,
      createdAt: expect.any(Date),
      settings: {
        theme: 'dark',
        tags: ['a', 'b'],
      },
      role: 'guest',
    });

    const timestamp = 1_701_234_567_890;
    const minimalRow = schema.parse({
      id: 'db-id-2',
      name: 'Jane Roe',
      salary: 2100,
      createdAt: timestamp,
      role: 1,
    });

    expect(minimalRow).toMatchObject({
      id: 'db-id-2',
      name: 'Jane Roe',
      salary: 2100,
      createdAt: new Date(timestamp),
      role: 'user',
    });

    type SelectShape = z.infer<typeof schema>;
    type ExpectedSelect = {
      id: string;
      name: string;
      age?: number | undefined;
      salary: number;
      height?: number | undefined;
      isActive?: boolean | undefined;
      createdAt: Date;
      settings?: {
        theme: string;
        tags: string[];
      } | undefined;
      role: 'admin' | 'user' | 'guest';
    };
    type _SelectTest = Expect<Equal<SelectShape, ExpectedSelect>>;
  });
});
