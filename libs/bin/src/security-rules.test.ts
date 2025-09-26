import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { sql } from './utils/sql';
import { b } from './builder';
import { hasWhereClauseCheck } from './security/has-where-clause-check';

describe('security rules end-to-end', () => {
  describe('basic security rules', () => {
    it('should enforce RBAC (Role-Based Access Control)', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        userId: b.text().notNull()
      }).secure((query, user: { id: string; role: string }) => {
        if (query.type === 'delete') {
          throw new Error('RBAC: delete requires admin role');
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
      })).rejects.toThrow('RBAC: delete requires admin role');

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

    it('should enforce ABAC (Attribute-Based Access Control)', async () => {
      const documents = b.table('documents', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        ownerId: b.text().notNull(),
        isPublic: b.boolean()
      }).secure((query, user: { id: string }) => {
        if (query.type === 'insert') {
          if (query.data?.ownerId !== user.id) throw new Error('ABAC: ownerId must match current user');
        } else if (query.type === 'update') {
          hasWhereClauseCheck(
            query.analysis,
            documents.ownerId.equalityCheck(user.id),
            'ABAC: only owner can update document'
          );

          documents.ownerId.assertImmutable(query.data, user.id)
        } else if (query.type === 'delete') {
          hasWhereClauseCheck(
            query.analysis,
            documents.ownerId.equalityCheck(user.id),
            'ABAC: only owner can delete document'
          );
        }
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
      })).rejects.toThrow('ABAC: ownerId must match current user');

      // Should allow update when WHERE clause keeps ownership restriction
      await expect(documents.update({
        data: { title: 'Updated Title' },
        where: sql`ownerId = ${user.id}`
      })).resolves.not.toThrow();

      // Should reject update if WHERE clause is missing ownership filter
      await expect(documents.update({
        data: { title: 'No ownership filter' },
        where: sql`title = 'My Document'`
      })).rejects.toThrow('ABAC: only owner can update document (table: documents)');

      // Should reject update if attempting to change ownerId
      await expect(documents.update({
        data: { ownerId: 'hacker' },
        where: sql`ownerId = ${user.id}`
      })).rejects.toThrow('Column ownerId is immutable');

      // Should allow delete when WHERE clause keeps ownership restriction
      await expect(documents.delete({
        where: sql`ownerId = ${user.id}`
      })).resolves.not.toThrow();

      // Should reject delete without ownership filter
      await expect(documents.delete({
        where: sql`title = 'My Document'`
      })).rejects.toThrow('ABAC: only owner can delete document (table: documents)');
    });
  });

  describe('db.query integration', () => {
    it('enforces security rules for queries without a privileged user', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull()
      }).secure((query, user: { role: string }) => {
        if (user.role === 'admin') return;
        throw new Error(`RBAC: ${query.type} requires admin role`);
      });

      const db = b.db({ schema: { posts } });
      await db._connectDriver({
        exec: async () => {},
        run: async () => [{ id: 'post-1', title: 'Post' }]
      });

      db.connectUser({ role: 'user' });

      await expect(
        db.query`SELECT id, title FROM posts`.execute(z.object({ id: z.string(), title: z.string() }))
      ).rejects.toThrow('RBAC: select requires admin role');

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
      }).secure(() => {
        postsRuleInvoked += 1;
      });

      const users = b.table('users', {
        id: b.id(),
        role: b.text().notNull()
      }).secure(() => {
        usersRuleInvoked += 1;
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
