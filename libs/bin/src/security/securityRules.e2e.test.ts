import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { b, immutable } from '../index';
import { sql } from '../utils/sql';
import { BinNodeDriver } from '../bin-node-driver';
import { unlink } from 'fs/promises';

describe('security rules end-to-end with bin-node-driver', () => {
  let driver: BinNodeDriver;
  let dbPath: string;

  beforeEach(async () => {
    // Use a unique database file for each test
    dbPath = `/tmp/test_security_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.db`;
    driver = new BinNodeDriver(dbPath);
  });

  afterEach(async () => {
    // Clean up the test database file
    try {
      await unlink(dbPath);
    } catch (e) {
      // Ignore errors if file doesn't exist
    }
  });

  describe('RBAC with real database operations', () => {
    it('should enforce role-based access control on actual database', async () => {
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
            return true;
        }
      });

      const db = b.db({ schema: { posts } });
      await db._connectDriver(driver);

      // Create the table
      driver.exec(db.getSchemaDefinition());

      // Admin user should be able to insert, update, and delete
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);
      
      const insertedPost = await posts.insert({
        title: 'Admin Post',
        content: 'Admin content',
        userId: 'admin123'
      });
      
      expect(insertedPost).toMatchObject({
        title: 'Admin Post',
        content: 'Admin content',
        userId: 'admin123',
        id: expect.any(String)
      });

      await posts.update({
        data: { title: 'Updated Admin Post' },
        where: sql`userId = 'admin123'`
      });

      await posts.delete({
        where: sql`userId = 'admin123'`
      });

      // Regular user should not be able to delete
      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      const userPost = await posts.insert({
        title: 'User Post',
        content: 'User content',
        userId: 'user123'
      });

      expect(userPost).toMatchObject({
        title: 'User Post',
        userId: 'user123'
      });

      await posts.update({
        data: { title: 'Updated User Post' },
        where: sql`userId = 'user123'`
      });

      await expect(posts.delete({
        where: sql`userId = 'user123'`
      })).rejects.toThrow('Security check failed for delete operation on table posts');
    });
  });

  describe('Data-aware security rules with real data', () => {
    it('should prevent ownership changes with real database', async () => {
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
          return !query.data.hasOwnProperty('userId') || query.data.userId === user.id;
        }
        
        return query.type === 'select' || query.type === 'delete';
      });

      const db = b.db({ schema: { profiles } });
      await db._connectDriver(driver);
      driver.exec(db.getSchemaDefinition());

      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      // Should allow creating profile for self
      const profile = await profiles.insert({
        userId: 'user123',
        displayName: 'John Doe',
        bio: 'Software engineer'
      });

      expect(profile).toMatchObject({
        userId: 'user123',
        displayName: 'John Doe',
        bio: 'Software engineer'
      });

      // Should allow updating without changing userId
      await profiles.update({
        data: { displayName: 'John Updated', bio: 'Senior engineer' },
        where: sql`userId = ${user.id}`
      });

      // Should reject changing userId to someone else
      await expect(profiles.update({
        data: { displayName: 'Hacked', userId: 'other_user' },
        where: sql`userId = ${user.id}`
      })).rejects.toThrow('Security check failed for update operation on table profiles');

      // Should reject creating profile for others
      await expect(profiles.insert({
        userId: 'other_user',
        displayName: 'Jane Doe',
        bio: 'Designer'
      })).rejects.toThrow('Security check failed for insert operation on table profiles');
    });
  });

  describe('Immutable fields with real database', () => {
    it('should prevent updating immutable fields in real database', async () => {
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
      await db._connectDriver(driver);
      driver.exec(db.getSchemaDefinition());

      // Insert a user
      const createdAt = new Date('2023-01-01');
      const user = await users.insert({
        email: 'user@example.com',
        username: 'johndoe',
        displayName: 'John Doe',
        createdAt
      });

      expect(user).toMatchObject({
        email: 'user@example.com',
        username: 'johndoe',
        displayName: 'John Doe',
        createdAt
      });

      // Should allow updating mutable fields
      await users.update({
        data: { username: 'john_doe_updated', displayName: 'John Updated' },
        where: sql`id = ${user.id}`
      });

      // Should reject updating immutable email
      await expect(users.update({
        data: { email: 'newemail@example.com', displayName: 'Updated' },
        where: sql`id = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table users');

      // Should reject updating immutable createdAt
      await expect(users.update({
        data: { createdAt: new Date(), displayName: 'Updated' },
        where: sql`id = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table users');
    });

    it('should combine immutable rules with custom security rules in real database', async () => {
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
               return query.data?.authorId === user.id || !query.data.hasOwnProperty('authorId');
             }
             
             return query.type === 'select';
           });

      const db = b.db({ schema: { posts } });
      await db._connectDriver(driver);
      driver.exec(db.getSchemaDefinition());

      const user = { id: 'author123', role: 'user' };
      db.connectUser(user);

      // Should allow creating post for self
      const publishedAt = new Date('2023-06-01');
      const post = await posts.insert({
        title: 'My Post',
        content: 'Hello world',
        authorId: 'author123',
        publishedAt,
        isPublished: true
      });

      expect(post).toMatchObject({
        title: 'My Post',
        content: 'Hello world',
        authorId: 'author123',
        publishedAt,
        isPublished: true
      });

      // Should allow updating content/title (mutable fields)
      await posts.update({
        data: { title: 'Updated Title', content: 'Updated content' },
        where: sql`authorId = ${user.id}`
      });

      // Should reject trying to change immutable authorId (immutable rule kicks in first)
      await expect(posts.update({
        data: { authorId: 'other_author', title: 'Stolen Post' },
        where: sql`id = ${post.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // Should reject trying to change immutable publishedAt
      await expect(posts.update({
        data: { publishedAt: new Date(), title: 'Backdated Post' },
        where: sql`authorId = ${user.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');
    });
  });

  describe('Complex multi-table scenario with real database', () => {
    it('should handle complete blog system with users, posts, and comments', async () => {
      const users = b.table('users', {
        id: b.id(),
        email: b.text().notNull(),
        username: b.text().notNull(),
        role: b.text().notNull(),
        createdAt: b.date()
      });
      
      users.addImmutableRule(immutable(users.id))
           .addImmutableRule(immutable(users.email))
           .addImmutableRule(immutable(users.createdAt))
           .secure((query, user: { id: string; role: string }) => {
             if (user.role === 'admin') return true;
             
             if (query.type === 'insert') {
               return query.data?.role === 'user';
             }
             
             if (query.type === 'update') {
               if (query.data.hasOwnProperty('role')) return false;
               return true;
             }
             
             return query.type === 'select';
           });

      const posts = b.table('posts', {
        id: b.id(),
        title: b.text().notNull(),
        content: b.text(),
        authorId: b.text().notNull(),
        isPublished: b.boolean(),
        createdAt: b.date()
      });
      
      posts.addImmutableRule(immutable(posts.id))
           .addImmutableRule(immutable(posts.authorId))
           .addImmutableRule(immutable(posts.createdAt))
           .secure((query, user: { id: string; role: string }) => {
             if (user.role === 'admin') return true;
             
             if (query.type === 'insert') {
               return query.data?.authorId === user.id;
             }
             
             return true;
           });

      const comments = b.table('comments', {
        id: b.id(),
        postId: b.text().notNull(),
        authorId: b.text().notNull(),
        content: b.text().notNull(),
        isModerated: b.boolean(),
        createdAt: b.date()
      });
      
      comments.addImmutableRule(immutable(comments.id))
              .addImmutableRule(immutable(comments.postId))
              .addImmutableRule(immutable(comments.authorId))
              .addImmutableRule(immutable(comments.createdAt))
              .secure((query, user: { id: string; role: string }) => {
                if (user.role === 'admin' || user.role === 'moderator') return true;
                
                if (query.type === 'insert') {
                  if (query.data?.isModerated !== false && query.data?.isModerated !== undefined) return false;
                  return query.data?.authorId === user.id;
                }
                
                if (query.type === 'update') {
                  if (query.data.hasOwnProperty('isModerated')) return false;
                  return true;
                }
                
                return query.type === 'select' || query.type === 'delete';
              });

      const db = b.db({ schema: { users, posts, comments } });
      await db._connectDriver(driver);
      driver.exec(db.getSchemaDefinition());

      // Create a regular user
      const user = { id: 'user123', role: 'user' };
      db.connectUser(user);

      const createdAt = new Date('2023-01-01');
      const newUser = await users.insert({
        email: 'user@example.com',
        username: 'johndoe',
        role: 'user',
        createdAt
      });

      expect(newUser).toMatchObject({
        email: 'user@example.com',
        username: 'johndoe',
        role: 'user',
        createdAt
      });

      // User creates a post
      const postCreatedAt = new Date('2023-06-01');
      const post = await posts.insert({
        title: 'My First Post',
        content: 'This is my first post',
        authorId: 'user123',
        isPublished: false,
        createdAt: postCreatedAt
      });

      expect(post).toMatchObject({
        title: 'My First Post',
        authorId: 'user123',
        createdAt: postCreatedAt
      });

      // User adds a comment to the post
      const commentCreatedAt = new Date('2023-06-02');
      const comment = await comments.insert({
        postId: post.id as string,
        authorId: 'user123',
        content: 'Great post!',
        isModerated: false,
        createdAt: commentCreatedAt
      });

      expect(comment).toMatchObject({
        postId: post.id,
        authorId: 'user123',
        content: 'Great post!',
        isModerated: false,
        createdAt: commentCreatedAt
      });

      // User can update post content but not authorId
      await posts.update({
        data: { title: 'Updated Post Title', content: 'Updated content' },
        where: sql`id = ${post.id}`
      });

      // User cannot change post authorId (immutable)
      await expect(posts.update({
        data: { authorId: 'other_user', title: 'Stolen' },
        where: sql`id = ${post.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table posts');

      // User cannot moderate their own comment (security rule)
      await expect(comments.update({
        data: { isModerated: true },
        where: sql`id = ${comment.id}`
      })).rejects.toThrow('Security check failed for update operation on table comments');

      // User cannot change comment's postId (immutable)
      await expect(comments.update({
        data: { postId: 'different_post', content: 'Updated comment' },
        where: sql`id = ${comment.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table comments');

      // Switch to moderator user
      const moderator = { id: 'mod123', role: 'moderator' };
      db.connectUser(moderator);

      // Moderator can moderate comments
      await comments.update({
        data: { isModerated: true },
        where: sql`id = ${comment.id}`
      });

      // But moderator still cannot violate immutable rules
      await expect(comments.update({
        data: { postId: 'different_post' },
        where: sql`id = ${comment.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table comments');

      // Switch to admin user
      const admin = { id: 'admin123', role: 'admin' };
      db.connectUser(admin);

      // Admin can do most things but still blocked by immutable rules
      await expect(users.update({
        data: { email: 'newemail@example.com' },
        where: sql`id = ${newUser.id}`
      })).rejects.toThrow('Immutable field violation for update operation on table users');
    });
  });

  describe('Performance and data consistency', () => {
    it('should handle bulk operations with security rules efficiently', async () => {
      const articles = b.table('articles', {
        id: b.id(),
        title: b.text().notNull(),
        slug: b.text().notNull(),
        authorId: b.text().notNull(),
        status: b.text().notNull(),
        createdAt: b.date()
      });
      
      articles.addImmutableRule(immutable(articles.id))
              .addImmutableRule(immutable(articles.slug))
              .addImmutableRule(immutable(articles.authorId))
              .addImmutableRule(immutable(articles.createdAt))
              .secure((query, user: { id: string; role: string }) => {
                if (user.role === 'admin') return true;
                
                if (query.type === 'insert') {
                  return query.data?.authorId === user.id;
                }
                
                if (query.type === 'update') {
                  // Only allow changing status and title
                  const allowedFields = ['status', 'title'];
                  const dataKeys = Object.keys(query.data || {});
                  return dataKeys.every(key => allowedFields.includes(key));
                }
                
                return query.type === 'select';
              });

      const db = b.db({ schema: { articles } });
      await db._connectDriver(driver);
      driver.exec(db.getSchemaDefinition());

      const user = { id: 'author123', role: 'user' };
      db.connectUser(user);

      // Create multiple articles
      const articles_data = [];
      for (let i = 0; i < 5; i++) {
        const article = await articles.insert({
          title: `Article ${i + 1}`,
          slug: `article-${i + 1}`,
          authorId: 'author123',
          status: 'draft',
          createdAt: new Date(`2023-0${i + 1}-01`)
        });
        articles_data.push(article);
        
        expect(article).toMatchObject({
          title: `Article ${i + 1}`,
          slug: `article-${i + 1}`,
          authorId: 'author123',
          status: 'draft'
        });
      }

      // Update allowed fields on multiple articles
      for (const article of articles_data) {
        await articles.update({
          data: { status: 'published', title: `${article.title} - Published` },
          where: sql`id = ${article.id}`
        });
      }

      // Verify immutable constraints are still enforced
      await expect(articles.update({
        data: { slug: 'new-slug', status: 'published' },
        where: sql`id = ${articles_data[0].id}`
      })).rejects.toThrow('Immutable field violation for update operation on table articles');

      // Verify security rules are still enforced
      await expect(articles.update({
        data: { authorId: 'other_author', status: 'published' },
        where: sql`id = ${articles_data[0].id}`
      })).rejects.toThrow('Immutable field violation for update operation on table articles');
    });
  });
});