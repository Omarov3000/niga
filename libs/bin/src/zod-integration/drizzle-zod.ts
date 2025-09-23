import { integer, pgTable, real, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from 'drizzle-zod';
import { z } from "zod";
import { Expect, Equal } from '../utils';

const users = pgTable('users', {
  name: text('name').notNull(),
  age: integer('age').default(18),
  height: real('height'),
});

const insertSchema = createInsertSchema(users);

type InsertUser = z.infer<typeof insertSchema>;

type _Test = Expect<Equal<InsertUser, {
  name: string;
  age?: number | undefined | null;
  height?: number | undefined | null;
}>>;
