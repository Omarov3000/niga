import { describe, it, expect } from 'vitest';
import { b, immutable } from './index';
import { sql } from './utils/sql';

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
        exec: () => {}, 
        run: () => [] 
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
          return query.data?.ownerId === user.id;
        }
        
        if (query.type === 'update' || query.type === 'delete') {
          // Must have WHERE clause checking ownerId
          return query.accessedTables.includes('documents');
        }
        
        return false;
      });

      const db = b.db({ schema: { documents } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
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

  describe('data-aware security rules', () => {
    it('should prevent ownership changes in updates', async () => {
      const profiles = b.table('profiles', {
        id: b.id(),
        userId: b.text().notNull(),
        displayName: b.text().notNull(),
        bio: b.text()
      }).secure((query, user: { id: string; role: string }) => {
        if (user.role === 'admin') return true;
        
        if (query.type === 'insert') {
          return query.data?.userId === user.id;
        }
        
        if (query.type === 'update') {
          // Cannot change userId or must keep it as current user
          return !query.data.hasOwnProperty('userId') || query.data.userId === user.id;
        }
        
        return query.type === 'select' || query.type === 'delete';
      });

      const db = b.db({ schema: { profiles } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      // Should allow creating profile for self
      await expect(profiles.insert({
        userId: 'user123',
        displayName: 'John Doe',
        bio: 'Software engineer'
      })).resolves.not.toThrow();

      // Should reject creating profile for others
      await expect(profiles.insert({
        userId: 'other_user',
        displayName: 'Jane Doe',
        bio: 'Designer'
      })).rejects.toThrow('Security check failed for insert operation on table profiles');

      // Should allow updating without changing userId
      await expect(profiles.update({
        data: { displayName: 'John Updated', bio: 'Senior engineer' },
        where: sql`userId = ${user.id}`
      })).resolves.not.toThrow();

      // Should reject changing userId to someone else
      await expect(profiles.update({
        data: { displayName: 'Hacked', userId: 'other_user' },
        where: sql`userId = ${user.id}`
      })).rejects.toThrow('Security check failed for update operation on table profiles');

      // Admin should be able to change anything
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);

      await expect(profiles.update({
        data: { displayName: 'Admin Updated', userId: 'other_user' },
        where: sql`id = 'some_profile_id'`
      })).resolves.not.toThrow();
    });

    it('should enforce complex business rules with data inspection', async () => {
      const orders = b.table('orders', {
        id: b.id(),
        customerId: b.text().notNull(),
        status: b.text().notNull(),
        amount: b.real().notNull(),
        isRushOrder: b.boolean()
      }).secure((query, user: { id: string; role: string; maxOrderAmount: number }) => {
        if (user.role === 'admin') return true;
        
        if (query.type === 'insert') {
          // Regular users can only create orders for themselves
          if (query.data?.customerId !== user.id) return false;
          
          // Check amount limits
          if (query.data?.amount > user.maxOrderAmount) return false;
          
          // Only premium users can create rush orders
          if (query.data?.isRushOrder && user.role !== 'premium') return false;
          
          return true;
        }
        
        if (query.type === 'update') {
          // Cannot change customer after creation
          if (query.data.hasOwnProperty('customerId')) return false;
          
          // Cannot increase amount beyond limit
          if (query.data.hasOwnProperty('amount') && query.data.amount > user.maxOrderAmount) return false;
          
          // Only certain users can mark as rush
          if (query.data.hasOwnProperty('isRushOrder') && query.data.isRushOrder && user.role !== 'premium') return false;
          
          return true;
        }
        
        return query.type === 'select';
      });

      const db = b.db({ schema: { orders } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Regular user with low limit
      const regularUser = { id: 'user123', role: 'user', maxOrderAmount: 100 };
      db.connectUser(regularUser);

      // Should allow creating small order
      await expect(orders.insert({
        customerId: 'user123',
        status: 'pending',
        amount: 50,
        isRushOrder: false
      })).resolves.not.toThrow();

      // Should reject order over limit
      await expect(orders.insert({
        customerId: 'user123',
        status: 'pending',
        amount: 150,
        isRushOrder: false
      })).rejects.toThrow('Security check failed for insert operation on table orders');

      // Should reject rush order for regular user
      await expect(orders.insert({
        customerId: 'user123',
        status: 'pending',
        amount: 50,
        isRushOrder: true
      })).rejects.toThrow('Security check failed for insert operation on table orders');

      // Should reject creating order for someone else
      await expect(orders.insert({
        customerId: 'other_user',
        status: 'pending',
        amount: 50,
        isRushOrder: false
      })).rejects.toThrow('Security check failed for insert operation on table orders');

      // Premium user should be able to create rush orders
      const premiumUser = { id: 'premium123', role: 'premium', maxOrderAmount: 500 };
      db.connectUser(premiumUser);

      await expect(orders.insert({
        customerId: 'premium123',
        status: 'pending',
        amount: 200,
        isRushOrder: true
      })).resolves.not.toThrow();

      // Should reject changing customerId in update
      await expect(orders.update({
        data: { customerId: 'hacker', status: 'shipped' },
        where: sql`id = 'order123'`
      })).rejects.toThrow('Security check failed for update operation on table orders');
    });
  });

  describe('immutable field rules', () => {
    it('should prevent updating immutable fields', async () => {
      const users = b.table('users', {
        id: b.id(),
        email: b.text().notNull(),
        username: b.text().notNull(),
        displayName: b.text(),
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

      // Should allow insert with all fields
      await expect(users.insert({
        email: 'user@example.com',
        username: 'johndoe',
        displayName: 'John Doe',
        createdAt: new Date()
      })).resolves.not.toThrow();

      // Should allow updating mutable fields
      await expect(users.update({
        data: { username: 'john_doe_updated', displayName: 'John Updated' },
        where: sql`id = 'user123'`
      })).resolves.not.toThrow();

      // Should reject updating immutable id
      await expect(users.update({
        data: { id: 'new_id', displayName: 'Hacked' },
        where: sql`email = 'user@example.com'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');

      // Should reject updating immutable email
      await expect(users.update({
        data: { email: 'newemail@example.com', displayName: 'Updated' },
        where: sql`id = 'user123'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');

      // Should reject updating immutable createdAt
      await expect(users.update({
        data: { createdAt: new Date(), displayName: 'Updated' },
        where: sql`id = 'user123'`
      })).rejects.toThrow('Immutable field violation for update operation on table users');
    });

    it('should combine immutable rules with custom security rules', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        authorId: b.text().notNull(),
        publishedAt: b.date(),
        isPublished: b.boolean()
      });
      
      posts.addImmutableRule(immutable(posts.id))
           .addImmutableRule(immutable(posts.authorId))
           .addImmutableRule(immutable(posts.publishedAt))
           .secure((query, user: { id: string; role: string }) => {
          if (user.role === 'admin') return true;
          
          if (query.type === 'insert') {
            return query.data?.authorId === user.id;
          }
          
          if (query.type === 'update') {
            // Users can only update their own posts
            // But they cannot change ownership (handled by immutable rule)
            return query.data?.authorId === user.id || !query.data.hasOwnProperty('authorId');
          }
          
          return query.type === 'select';
        });

      const db = b.db({ schema: { posts } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      const user = { id: 'author123', role: 'user' };
      db.connectUser(user);

      // Should allow creating post for self
      await expect(posts.insert({
        title: 'My Post',
        content: 'Hello world',
        authorId: 'author123',
        publishedAt: new Date(),
        isPublished: true
      })).resolves.not.toThrow();

      // Should allow updating content/title (mutable fields)
      await expect(posts.update({
        data: { title: 'Updated Title', content: 'Updated content' },
        where: sql`authorId = ${user.id}`
      })).resolves.not.toThrow();

      // Should reject trying to change immutable authorId (immutable rule kicks in first)
      await expect(posts.update({
        data: { authorId: 'other_author', title: 'Stolen Post' },
        where: sql`id = 'post123'`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // Should reject trying to change immutable publishedAt
      await expect(posts.update({
        data: { publishedAt: new Date(), title: 'Backdated Post' },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // Should reject trying to change immutable id
      await expect(posts.update({
        data: { id: 'new_post_id', title: 'Updated' },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // Admin should still be blocked by immutable rules
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);

      await expect(posts.update({
        data: { authorId: 'someone_else' },
        where: sql`id = 'post123'`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multi-table schema with different security levels', async () => {
      const users = b.table('users', {
        id: b.id(),
        email: b.text().notNull(),
        role: b.text().notNull()
      });
      
      users.addImmutableRule(immutable(users.id))
           .secure((query, user: { id: string; role: string }) => {
          if (user.role === 'admin') return true;
          
          if (query.type === 'insert') {
            // Users can self-register but only as 'user' role
            return query.data?.role === 'user';
          }
          
          if (query.type === 'update') {
            // Cannot change role or id, can only update own records
            if (query.data.hasOwnProperty('role')) return false;
            return true; // WHERE clause should enforce user access
          }
          
          return query.type === 'select';
        });

      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        authorId: b.text().notNull(),
        isPublished: b.boolean()
      });
      
      posts.addImmutableRule(immutable(posts.id))
           .addImmutableRule(immutable(posts.authorId))
           .secure((query, user: { id: string; role: string }) => {
          if (user.role === 'admin') return true;
          
          if (query.type === 'insert') {
            return query.data?.authorId === user.id;
          }
          
          return true; // Other operations allowed with proper WHERE clauses
        });

      const comments = b.table('comments', {
        id: b.id(),
        postId: b.text().notNull(),
        authorId: b.text().notNull(),
        content: b.text().notNull(),
        isModerated: b.boolean()
      });
      
      comments.addImmutableRule(immutable(comments.id))
              .addImmutableRule(immutable(comments.postId))
              .addImmutableRule(immutable(comments.authorId))
              .secure((query, user: { id: string; role: string }) => {
          if (user.role === 'admin' || user.role === 'moderator') return true;
          
          if (query.type === 'insert') {
            // Users can comment but cannot set moderation status
            if (query.data?.isModerated !== false && query.data?.isModerated !== undefined) return false;
            return query.data?.authorId === user.id;
          }
          
          if (query.type === 'update') {
            // Regular users cannot change moderation status
            if (query.data.hasOwnProperty('isModerated')) return false;
            return true;
          }
          
          return query.type === 'select' || query.type === 'delete';
        });

      const db = b.db({ schema: { users, posts, comments } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Regular user operations
      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      // Should allow self-registration as user
      await expect(users.insert({
        email: 'user@example.com',
        role: 'user'
      })).resolves.not.toThrow();

      // Should reject registration as admin
      await expect(users.insert({
        email: 'hacker@example.com',
        role: 'admin'
      })).rejects.toThrow('Security check failed for insert operation on table users');

      // Should allow creating posts
      await expect(posts.insert({
        title: 'My Post',
        authorId: 'user123',
        isPublished: false
      })).resolves.not.toThrow();

      // Should allow creating comments
      await expect(comments.insert({
        postId: 'post123',
        authorId: 'user123',
        content: 'Great post!',
        isModerated: false
      })).resolves.not.toThrow();

      // Should reject trying to moderate own comment
      await expect(comments.update({
        data: { content: 'Updated comment', isModerated: true },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Security check failed for update operation on table comments');

      // Moderator operations
      const moderator = { id: 'mod123', role: 'moderator' };
      db.connectUser(moderator);

      // Should allow moderating comments
      await expect(comments.update({
        data: { isModerated: true },
        where: sql`id = 'comment123'`
      })).resolves.not.toThrow();

      // But still blocked by immutable rules
      await expect(comments.update({
        data: { postId: 'different_post', isModerated: true },
        where: sql`id = 'comment123'`
      })).rejects.toThrow('Immutable field violation for update operation on table comments');
    });

    it('should work without user context (no security checks)', async () => {
      const publicData = b.table('public_data', {
        id: b.id(),
        name: b.text().notNull(),
        value: b.text()
      }).secure((query, user) => {
        // This should not be called when no user is connected
        return user?.role === 'admin';
      });

      const db = b.db({ schema: { publicData } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // No user connected - security rules should be bypassed
      await expect(publicData.insert({
        name: 'Test',
        value: 'Public value'
      })).resolves.not.toThrow();

      await expect(publicData.update({
        data: { value: 'Updated value' },
        where: sql`name = 'Test'`
      })).resolves.not.toThrow();

      await expect(publicData.delete({
        where: sql`name = 'Test'`
      })).resolves.not.toThrow();
    });
  });
});