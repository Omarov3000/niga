import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { sql } from './utils/sql';
import { b } from './builder';

describe('security rules end-to-end', () => {
  describe('basic security rules', () => {
    it('should enforce RBAC (Role-Based Access Control)', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        userId: b.text().notNull()
      }).secure((query, user: { id: string; role: string }) => {
        if (user.role === 'admin') return true;

        switch (query.type) {
          case 'delete':
            return false; // Only admins can delete
          case 'insert':
          case 'update':
          case 'select':
            return true; // Regular users can read/write
        }
      });

      const db = b.db({ schema: { posts } });
      await db._connectDriver({
        exec: async () => {},
        run: async () => []
      });

      // Admin user should be able to delete
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);

      await expect(posts.delete({
        where: sql`id = 'post123'`
      })).resolves.not.toThrow();

      // Regular user should not be able to delete
      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      await expect(posts.delete({
        where: sql`id = 'post123'`
      })).rejects.toThrow('Security check failed for delete operation on table posts');

      // But regular user should be able to insert and update
      await expect(posts.insert({
        title: 'My Post',
        content: 'Hello world',
        userId: 'user123'
      })).resolves.not.toThrow();

      await expect(posts.update({
        data: { title: 'Updated Post' },
        where: sql`userId = 'user123'`
      })).resolves.not.toThrow();
    });

    it('should enforce ABAC (Attribute-Based Access Control) with WHERE clause checking', async () => {
      const documents = b.table('documents', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        ownerId: b.text().notNull(),
        isPublic: b.boolean()
      }).secure((query, user: { id: string }) => {
        // Users can only access their own documents unless public
        if (query.type === 'select') return true; // Allow all selects (WHERE clause will be checked separately)

        if (query.type === 'insert') {
          return query.data?.ownerId === user.id; // user cannot insert data for other users
        }

        if (query.type === 'update') {
          // Cannot change ownership; if provided it must match current user
          return query.data?.ownerId === undefined || query.data.ownerId === user.id;
        }

        if (query.type === 'delete') {
          // Allow; WHERE ownerId is validated elsewhere
          return true;
        }

        return false;
      });

      const db = b.db({ schema: { documents } });
      await db._connectDriver({
        exec: async () => {},
        run: async () => []
      });

      const user = { id: 'user123' };
      db.connectUser(user);

      // Should allow creating documents for self
      await expect(documents.insert({
        title: 'My Document',
        content: 'Private content',
        ownerId: 'user123',
        isPublic: false
      })).resolves.not.toThrow();

      // Should reject creating documents for others
      await expect(documents.insert({
        title: 'Other Document',
        content: 'Content',
        ownerId: 'other_user',
        isPublic: false
      })).rejects.toThrow('Security check failed for insert operation on table documents');

      // Should allow update and delete (WHERE clause checking would be done separately)
      await expect(documents.update({
        data: { title: 'Updated Title' },
        where: sql`ownerId = ${user.id}`
      })).resolves.not.toThrow();

      await expect(documents.delete({
        where: sql`ownerId = ${user.id}`
      })).resolves.not.toThrow();
    });
  });

  describe('db.query integration', () => {
    it('enforces security rules for queries without a privileged user', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull()
      }).secure((query, user: { role: string }) => user?.role === 'admin');

      const db = b.db({ schema: { posts } });
      await db._connectDriver({
        exec: async () => {},
        run: async () => [{ id: 'post-1', title: 'Post' }]
      });

      db.connectUser({ role: 'user' });

      await expect(
        db.query`SELECT id, title FROM posts`.execute(z.object({ id: z.string(), title: z.string() }))
      ).rejects.toThrow('Security check failed for select operation on table posts');

      db.connectUser({ role: 'admin' });

      await expect(
        db.query`SELECT id, title FROM posts`.execute(z.object({ id: z.string(), title: z.string() }))
      ).resolves.toEqual([{ id: 'post-1', title: 'Post' }]);
    });

    it('runs security rules for every table referenced in the query', async () => {
      let postsRuleInvoked = 0;
      let usersRuleInvoked = 0;

      const posts = b.table('posts', {
        id: b.id(),
        authorId: b.text().notNull()
      }).secure((query) => {
        postsRuleInvoked += 1;
        return true;
      });

      const users = b.table('users', {
        id: b.id(),
        role: b.text().notNull()
      }).secure((query) => {
        usersRuleInvoked += 1;
        return true;
      });

      const db = b.db({ schema: { posts, users } });
      await db._connectDriver({
        exec: async () => {},
        run: async () => [{ id: 'post-1', authorId: 'user-1', role: 'admin' }]
      });

      db.connectUser({ role: 'admin' });

      await db
        .query`SELECT p.id, u.role FROM posts p JOIN users u ON p.authorId = u.id`
        .execute(z.object({ id: z.string(), role: z.string() }));

      expect(postsRuleInvoked).toBe(1);
      expect(usersRuleInvoked).toBe(1);
    });
  });
});
