import { describe, it, expect } from 'vitest';
import { b, immutable } from './index';
import { sql } from './utils/sql';

describe('optional fields behavior', () => {
  describe('type system correctness', () => {
    it('should make fields with default functions optional in insert operations', () => {
      const users = b.table('users', {
        id: b.id(), // Should be optional (has $defaultFn)
        name: b.text().notNull(), // Should be required (notNull without default)
        email: b.text(), // Should be optional (has default empty string)
        age: b.integer(), // Should be optional (has default 0)  
        isActive: b.boolean(), // Should be optional (has default false)
        createdAt: b.date(), // Should be optional (has default new Date())
      });

      // Verify metadata is correct
      expect(users.id.__meta__.insertType).toBe('optional');
      expect(users.name.__meta__.insertType).toBe('required');
      expect(users.email.__meta__.insertType).toBe('optional');
      expect(users.age.__meta__.insertType).toBe('optional');
      expect(users.isActive.__meta__.insertType).toBe('optional');
      expect(users.createdAt.__meta__.insertType).toBe('optional');

      // This should compile fine - only name is required
      const insertData: Parameters<typeof users.insert>[0] = {
        name: 'John Doe'
      };

      expect(insertData).toMatchObject({
        name: 'John Doe'
      });
    });

    it('should handle mixed required and optional fields correctly', () => {
      const posts = b.table('posts', {
        id: b.id(), // Optional
        title: b.text().notNull(), // Required
        content: b.text(), // Optional
        authorId: b.text().notNull(), // Required
        isPublished: b.boolean(), // Optional
        viewCount: b.integer().default(0), // Optional
      });

      // Should compile - providing only required fields
      const minimalPost: Parameters<typeof posts.insert>[0] = {
        title: 'My Post',
        authorId: 'user123'
      };

      // Should also compile - providing optional fields too
      const fullPost: Parameters<typeof posts.insert>[0] = {
        title: 'My Post',
        content: 'Post content',
        authorId: 'user123',
        isPublished: true,
        viewCount: 100
      };

      expect(minimalPost).toMatchObject({
        title: 'My Post',
        authorId: 'user123'
      });

      expect(fullPost).toMatchObject({
        title: 'My Post',
        content: 'Post content',
        authorId: 'user123',
        isPublished: true,
        viewCount: 100
      });
    });
  });

  describe('runtime behavior with auto-generated IDs', () => {
    it('should auto-generate IDs when not provided', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
        email: b.text(),
      });

      const db = b.db({ schema: { users } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Should work without providing id
      const user = await users.insert({
        name: 'John Doe',
        email: 'john@example.com'
      });

      expect(user).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com'
      });
      expect(user.id).toEqual(expect.any(String));
      expect(user.id).toHaveLength(21); // nanoid default length
    });

    it('should use provided ID when explicitly given', async () => {
      const users = b.table('users', {
        id: b.id(),
        name: b.text().notNull(),
      });

      const db = b.db({ schema: { users } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Should use explicit ID when provided
      const user = await users.insert({
        id: 'explicit-id',
        name: 'John Doe'
      });

      expect(user).toMatchObject({
        id: 'explicit-id',
        name: 'John Doe'
      });
    });

    it('should apply default functions for omitted optional fields', async () => {
      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(), // Default: ''
        viewCount: b.integer(), // Default: 0
        isPublished: b.boolean(), // Default: false
        createdAt: b.date(), // Default: new Date()
      });

      const db = b.db({ schema: { posts } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Only provide required field
      const post = await posts.insert({
        title: 'My Post'
      });

      expect(post).toMatchObject({
        title: 'My Post',
        content: '', // Applied default
        viewCount: 0, // Applied default
        isPublished: false, // Applied default
      });
      expect(post.id).toEqual(expect.any(String));
      expect(post.createdAt).toEqual(expect.any(Date));
    });
  });

  describe('integration with security rules', () => {
    it('should work with security rules that check optional fields', async () => {
      const documents = b.table('documents', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        ownerId: b.text().notNull(),
        isPrivate: b.boolean(), // Optional, defaults to false
      }).secure((query, user: { id: string; role: string }) => {
        if (query.type === 'insert') {
          // Only allow creating documents for self
          if (query.data?.ownerId !== user.id) return false;
          
          // Regular users cannot create private documents
          if (query.data?.isPrivate && user.role !== 'admin') return false;
          
          return true;
        }
        return true;
      });

      const db = b.db({ schema: { documents } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Regular user
      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      // Should allow creating public document (isPrivate defaults to false)
      const doc = await documents.insert({
        title: 'Public Doc',
        ownerId: 'user123'
        // isPrivate omitted, should default to false
      });

      expect(doc).toMatchObject({
        title: 'Public Doc',
        ownerId: 'user123',
        isPrivate: false
      });

      // Should reject explicit private document for regular user
      await expect(documents.insert({
        title: 'Private Doc',
        ownerId: 'user123',
        isPrivate: true
      })).rejects.toThrow('Security check failed for insert operation');

      // Admin should be able to create private documents
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);

      const privateDoc = await documents.insert({
        title: 'Admin Private Doc',
        ownerId: 'admin123',
        isPrivate: true
      });

      expect(privateDoc).toMatchObject({
        title: 'Admin Private Doc',
        ownerId: 'admin123',
        isPrivate: true
      });
    });

    it('should work with immutable fields on optional columns', async () => {
      const profiles = b.table('profiles', {
        id: b.id(),
        userId: b.text().notNull(),
        displayName: b.text(),
        bio: b.text(),
        avatar: b.text(), // Optional
        createdAt: b.date(),
      });

      // Make optional fields immutable
      profiles.addImmutableRule(immutable(profiles.id))
              .addImmutableRule(immutable(profiles.avatar))
              .addImmutableRule(immutable(profiles.createdAt));

      const db = b.db({ schema: { profiles } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      // Create profile without optional avatar
      const profile = await profiles.insert({
        userId: 'user123',
        displayName: 'John Doe',
        bio: 'Software engineer'
        // avatar and createdAt omitted
      });

      expect(profile).toMatchObject({
        userId: 'user123',
        displayName: 'John Doe',
        bio: 'Software engineer'
      });
      expect(profile.avatar).toBe(''); // Default value
      expect(profile.createdAt).toEqual(expect.any(Date));

      // Should allow updating mutable fields
      await profiles.update({
        data: { displayName: 'John Updated', bio: 'Senior engineer' },
        where: sql`userId = 'user123'`
      });

      // Should reject updating immutable avatar
      await expect(profiles.update({
        data: { avatar: 'new-avatar.jpg' },
        where: sql`userId = 'user123'`
      })).rejects.toThrow('Immutable field violation for update operation');
    });

    it('should handle complex scenarios with mixed field types and security', async () => {
      const orders = b.table('orders', {
        id: b.id(), // Optional (auto-generated)
        customerId: b.text().notNull(), // Required
        amount: b.real().notNull(), // Required
        currency: b.text().default('USD'), // Optional with SQL default
        status: b.text().default('pending'), // Optional with SQL default
        isRushOrder: b.boolean(), // Optional (defaults to false)
        notes: b.text(), // Optional
        createdAt: b.date(), // Optional (auto-generated)
        processedAt: b.date(), // Optional (will get default Date)
      });

      orders.addImmutableRule(immutable(orders.id))
            .addImmutableRule(immutable(orders.customerId))
            .addImmutableRule(immutable(orders.createdAt))
            .secure((query, user: { id: string; maxAmount: number }) => {
              if (query.type === 'insert') {
                // Users can only create orders for themselves
                if (query.data?.customerId !== user.id) return false;
                
                // Amount limit check
                if (query.data?.amount > user.maxAmount) return false;
                
                return true;
              }
              return true;
            });

      const db = b.db({ schema: { orders } });
      await db._connectDriver({ 
        exec: () => {}, 
        run: () => [] 
      });

      const user = { id: 'customer123', maxAmount: 500 };
      db.connectUser(user);

      // Should work with minimal required fields
      const order = await orders.insert({
        customerId: 'customer123',
        amount: 99.99
        // All other fields should use defaults
      });

      expect(order).toMatchObject({
        customerId: 'customer123',
        amount: 99.99,
        currency: 'USD', // Default
        status: 'pending', // Default
        isRushOrder: false, // Default
        notes: '', // Default
      });
      expect(order.id).toEqual(expect.any(String));
      expect(order.createdAt).toEqual(expect.any(Date));
      expect(order.processedAt).toEqual(expect.any(Date)); // Gets default Date

      // Should work with optional fields provided
      const rushOrder = await orders.insert({
        customerId: 'customer123',
        amount: 299.99,
        currency: 'EUR',
        isRushOrder: true,
        notes: 'Urgent delivery needed'
      });

      expect(rushOrder).toMatchObject({
        customerId: 'customer123',
        amount: 299.99,
        currency: 'EUR',
        isRushOrder: true,
        notes: 'Urgent delivery needed'
      });

      // Should reject over amount limit
      await expect(orders.insert({
        customerId: 'customer123',
        amount: 600 // Over limit
      })).rejects.toThrow('Security check failed for insert operation');
    });
  });
});