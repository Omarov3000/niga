import { describe, it, expect } from 'vitest';
import { b } from '../builder';
import { sql } from '../utils/sql';
import { immutable, checkImmutableFields, createImmutableFieldsRule } from './immutableFields';

describe('immutableFields', () => {
  describe('immutable helper function', () => {
    it('should create immutable rule for column attached to table', () => {
      const users = b.table('users', {
        id: b.id(),
        email: b.text().notNull()
      });

      const rule = immutable(users.id);
      
      expect(rule).toMatchObject({
        tableName: 'users',
        fieldName: 'id'
      });
    });

    it('should throw error for column not attached to table', () => {
      const column = b.id();
      
      expect(() => immutable(column)).toThrow('Column must be attached to a table to create immutable rule');
    });
  });

  describe('checkImmutableFields', () => {
    it('should allow SELECT operations', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'select' as const,
        accessedTables: ['users']
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should allow INSERT operations', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'insert' as const,
        accessedTables: ['users'],
        data: { id: 'user123', name: 'John' }
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should allow DELETE operations', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'delete' as const,
        accessedTables: ['users']
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should allow UPDATE when no immutable fields are being updated', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'update' as const,
        accessedTables: ['users'],
        data: { name: 'John Updated', email: 'john@example.com' }
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should reject UPDATE when immutable field is being updated', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'update' as const,
        accessedTables: ['users'],
        data: { id: 'new_id', name: 'John Updated' }
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(false);
    });

    it('should allow UPDATE when immutable field is in data but for different table', () => {
      const rules = [{ tableName: 'posts', fieldName: 'id' }];
      const query = {
        type: 'update' as const,
        accessedTables: ['users'], // different table
        data: { id: 'new_id', name: 'John Updated' }
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should handle multiple immutable rules', () => {
      const rules = [
        { tableName: 'users', fieldName: 'id' },
        { tableName: 'users', fieldName: 'email' },
        { tableName: 'posts', fieldName: 'authorId' }
      ];
      
      const query = {
        type: 'update' as const,
        accessedTables: ['users'],
        data: { name: 'John Updated', bio: 'New bio' }
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });

    it('should reject UPDATE when any immutable field is being updated', () => {
      const rules = [
        { tableName: 'users', fieldName: 'id' },
        { tableName: 'users', fieldName: 'email' },
        { tableName: 'posts', fieldName: 'authorId' }
      ];
      
      const query = {
        type: 'update' as const,
        accessedTables: ['users'],
        data: { name: 'John Updated', email: 'newemail@example.com' } // updating immutable email
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(false);
    });

    it('should allow UPDATE with no data', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const query = {
        type: 'update' as const,
        accessedTables: ['users']
      };

      const result = checkImmutableFields(query, rules);
      expect(result).toBe(true);
    });
  });

  describe('createImmutableFieldsRule', () => {
    it('should create a security rule function', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const securityRule = createImmutableFieldsRule(rules);

      expect(typeof securityRule).toBe('function');
    });

    it('should return same result as checkImmutableFields when called', () => {
      const rules = [{ tableName: 'users', fieldName: 'id' }];
      const securityRule = createImmutableFieldsRule(rules);
      
      const query = {
        type: 'update' as const,
        accessedTables: ['users'],
        data: { id: 'new_id' }
      };

      const directResult = checkImmutableFields(query, rules);
      const ruleResult = securityRule(query);

      expect(ruleResult).toBe(directResult);
      expect(ruleResult).toBe(false);
    });
  });

  describe('integration with table', () => {
    it('should allow operations when no immutable fields are violated', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        email: b.text().notNull()
      });
      
      users.addImmutableRule(immutable(users.id));

      const db = b.db({ schema: { users } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Should allow update without touching id
      await expect(users.update({
        data: { name: 'New Name', email: 'new@example.com' },
        where: sql`id = 'user123'`
      })).resolves.not.toThrow();
    });

    it('should reject operations when immutable fields are violated', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        email: b.text().notNull()
      });
      
      users.addImmutableRule(immutable(users.id));

      const db = b.db({ schema: { users } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Should reject update that tries to modify id
      await expect(users.update({
        data: { id: 'new_id', name: 'New Name' },
        where: sql`name = 'old name'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');
    });

    it('should work with multiple immutable fields', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        email: b.text().notNull(),
        createdAt: b.date()
      });
      
      users.addImmutableRule(immutable(users.id))
           .addImmutableRule(immutable(users.email))
           .addImmutableRule(immutable(users.createdAt));

      const db = b.db({ schema: { users } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Should allow updating only mutable fields
      await expect(users.update({
        data: { name: 'New Name' },
        where: sql`id = 'user123'`
      })).resolves.not.toThrow();

      // Should reject updating any immutable field
      await expect(users.update({
        data: { name: 'New Name', email: 'new@example.com' },
        where: sql`id = 'user123'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');

      await expect(users.update({
        data: { name: 'New Name', createdAt: new Date() },
        where: sql`id = 'user123'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');
    });

    it('should work with custom security rules', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        authorId: b.text().notNull(),
        content: b.text()
      });
      
      posts.addImmutableRule(immutable(posts.id))
           .addImmutableRule(immutable(posts.authorId))
           .secure((query, user: { id: string; role: string }) => {
          if (user.role === 'admin') return true;
          if (query.type === 'update') {
            // Only allow users to update their own posts
            return query.data?.authorId === user.id || !query.data.hasOwnProperty('authorId');
          }
          return true;
        });

      const db = b.db({ schema: { posts } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      // Should allow updating content without touching immutable fields
      await expect(posts.update({
        data: { title: 'Updated Title', content: 'New content' },
        where: sql`authorId = ${user.id}`
      })).resolves.not.toThrow();

      // Should reject trying to update immutable authorId (immutable rule takes precedence)
      await expect(posts.update({
        data: { title: 'Updated Title', authorId: 'other_user' },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // Should reject trying to update immutable id
      await expect(posts.update({
        data: { id: 'new_post_id', title: 'Updated Title' },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');
    });
  });
});