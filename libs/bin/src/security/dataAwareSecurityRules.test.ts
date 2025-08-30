import { describe, it, expect } from 'vitest';
import { b } from '../builder';
import { sql } from '../utils/sql';

describe('data-aware security rules', () => {
  it('should allow access to insert data in security rules', async () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text().notNull(),
      userId: b.text().notNull(),
      isPrivate: b.boolean()
    }).secure((query, user: { id: string; role: string }) => {
      if (query.type === 'insert') {
        // User can only create posts for themselves
        return query.data?.userId === user.id;
      }
      return user.role === 'admin';
    });

    const db = b.db({ schema: { posts } });
    await db._connectDriver({ 
      exec: () => {}, 
      run: () => [] 
    });

    const user = { id: 'user123', role: 'user' };
    db.connectUser(user);
    
    // Should allow user to create posts for themselves
    const result = await posts.insert({
      title: 'My Post',
      userId: 'user123',
      isPrivate: false
    });

    expect(result).toMatchObject({
      title: 'My Post',
      userId: 'user123',
      isPrivate: false,
      id: expect.any(String)
    });
  });

  it('should reject insert when user tries to create posts for others', async () => {
    const posts = b.table('posts', {
      id: b.id(),
      title: b.text().notNull(),
      userId: b.text().notNull(),
      isPrivate: b.boolean()
    }).secure((query, user: { id: string; role: string }) => {
      if (query.type === 'insert') {
        // User can only create posts for themselves
        return query.data?.userId === user.id;
      }
      return user.role === 'admin';
    });

    const db = b.db({ schema: { posts } });
    await db._connectDriver({ 
      exec: () => {}, 
      run: () => [] 
    });

    const user = { id: 'user123', role: 'user' };
    db.connectUser(user);
    
    // Should reject when user tries to create posts for someone else
    await expect(posts.insert({
      title: 'Impersonated Post',
      userId: 'other_user456', // Different user ID
      isPrivate: false
    })).rejects.toThrow('Security check failed for insert operation');
  });

  it('should allow access to update data in security rules', async () => {
    const profiles = b.table('profiles', {
      id: b.id(),
      userId: b.text().notNull(),
      displayName: b.text().notNull(),
      email: b.text().notNull(),
      isPublic: b.boolean()
    }).secure((query, user: { id: string; role: string }) => {
      if (query.type === 'update') {
        // Users can only update their own profiles and cannot change userId
        const hasValidUserId = !query.data.hasOwnProperty('userId') || query.data.userId === user.id;
        return hasValidUserId;
      }
      return user.role === 'admin';
    });

    const db = b.db({ schema: { profiles } });
    await db._connectDriver({ 
      exec: () => {}, 
      run: () => [] 
    });

    const user = { id: 'user123', role: 'user' };
    db.connectUser(user);
    
    // Should allow updating profile without changing userId
    await expect(profiles.update({
      data: { 
        displayName: 'New Name',
        isPublic: true
      },
      where: sql`userId = ${user.id}`
    })).resolves.not.toThrow();
  });

  it('should reject update when user tries to change userId', async () => {
    const profiles = b.table('profiles', {
      id: b.id(),
      userId: b.text().notNull(),
      displayName: b.text().notNull(),
      email: b.text().notNull(),
      isPublic: b.boolean()
    }).secure((query, user: { id: string; role: string }) => {
      if (query.type === 'update') {
        // Users can only update their own profiles and cannot change userId
        const hasValidUserId = !query.data.hasOwnProperty('userId') || query.data.userId === user.id;
        return hasValidUserId;
      }
      return user.role === 'admin';
    });

    const db = b.db({ schema: { profiles } });
    await db._connectDriver({ 
      exec: () => {}, 
      run: () => [] 
    });

    const user = { id: 'user123', role: 'user' };
    db.connectUser(user);
    
    // Should reject when trying to change userId to someone else
    await expect(profiles.update({
      data: { 
        displayName: 'Hacked Name',
        userId: 'other_user456' // Trying to change ownership
      },
      where: sql`userId = ${user.id}`
    })).rejects.toThrow('Security check failed for update operation');
  });

  it('should combine data checks with WHERE clause checks', async () => {
    const documents = b.table('documents', {
      id: b.id(),
      title: b.text().notNull(),
      content: b.text().notNull(),
      ownerId: b.text().notNull(),
      isConfidential: b.boolean()
    }).secure((query, user: { id: string; clearanceLevel: number }) => {
      if (query.type === 'insert') {
        // Users with low clearance cannot create confidential documents
        if (query.data?.isConfidential && user.clearanceLevel < 5) {
          return false;
        }
        // Documents must be owned by the creating user
        return query.data?.ownerId === user.id;
      }
      
      if (query.type === 'update') {
        // Cannot change confidentiality or ownership
        const cannotChangeConfidential = !query.data.hasOwnProperty('isConfidential');
        const cannotChangeOwner = !query.data.hasOwnProperty('ownerId') || query.data.ownerId === user.id;
        return cannotChangeConfidential && cannotChangeOwner;
      }
      
      return user.clearanceLevel >= 3;
    });

    const db = b.db({ schema: { documents } });
    await db._connectDriver({ 
      exec: () => {}, 
      run: () => [] 
    });

    // High clearance user
    const highClearanceUser = { id: 'agent007', clearanceLevel: 9 };
    db.connectUser(highClearanceUser);
    
    // Should allow creating confidential documents
    await expect(documents.insert({
      title: 'Top Secret Plan',
      content: 'Classified information',
      ownerId: 'agent007',
      isConfidential: true
    })).resolves.toMatchObject({
      title: 'Top Secret Plan',
      ownerId: 'agent007',
      isConfidential: true
    });

    // Low clearance user
    const lowClearanceUser = { id: 'intern123', clearanceLevel: 2 };
    db.connectUser(lowClearanceUser);
    
    // Should reject creating confidential documents
    await expect(documents.insert({
      title: 'My Secret',
      content: 'Not so secret',
      ownerId: 'intern123',
      isConfidential: true
    })).rejects.toThrow('Security check failed for insert operation');

    // Should allow creating non-confidential documents
    await expect(documents.insert({
      title: 'Public Report',
      content: 'Anyone can read this',
      ownerId: 'intern123',
      isConfidential: false
    })).resolves.toMatchObject({
      title: 'Public Report',
      ownerId: 'intern123',
      isConfidential: false
    });
  });
});