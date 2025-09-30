import { describe, it, expect, vi } from 'vitest';
import { LiveQueryManager } from './live-query';
import { sql } from '../utils/sql';
import { rawQueryToAst } from './raw-query-to-ast';

describe('LiveQueryManager', () => {
  it('should subscribe and invalidate simple query', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`SELECT * FROM users WHERE id = ${1}`)
    };

    const unsubscribe = manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should invalidate joined query when any joined table changes', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        SELECT u.id, u.name, p.title
        FROM users u
        INNER JOIN posts p ON u.id = p.user_id
        WHERE u.active = ${true}
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(2);

    manager.invalidate('comments');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should invalidate recursive CTE query', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        WITH RECURSIVE category_tree AS (
          SELECT id, name, parent_id, 0 AS level
          FROM categories
          WHERE parent_id IS NULL

          UNION ALL

          SELECT c.id, c.name, c.parent_id, ct.level + 1
          FROM categories c
          INNER JOIN category_tree ct ON c.parent_id = ct.id
        )
        SELECT * FROM category_tree ORDER BY level, name
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('categories');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should invalidate complex select with subqueries', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        SELECT
          u.id,
          u.name,
          (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count,
          (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comment_count
        FROM users u
        WHERE u.id IN (
          SELECT DISTINCT user_id
          FROM posts
          WHERE created_at > ${'2024-01-01'}
        )
        ORDER BY post_count DESC
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(2);

    manager.invalidate('comments');
    expect(callback).toHaveBeenCalledTimes(3);

    manager.invalidate('sessions');
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('should handle multiple subscriptions independently', () => {
    const manager = new LiveQueryManager();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const query1 = {
      toAst: () => rawQueryToAst(sql`SELECT * FROM users`)
    };

    const query2 = {
      toAst: () => rawQueryToAst(sql`SELECT * FROM posts`)
    };

    manager.subscribe(query1, callback1);
    manager.subscribe(query2, callback2);

    manager.invalidate('users');
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(0);

    manager.invalidate('posts');
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('should invalidate query with LEFT JOIN', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        SELECT u.*, p.title
        FROM users u
        LEFT JOIN posts p ON u.id = p.user_id
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should handle WITH clause (non-recursive CTE)', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        WITH active_users AS (
          SELECT * FROM users WHERE active = ${true}
        )
        SELECT au.name, p.title
        FROM active_users au
        INNER JOIN posts p ON au.id = p.user_id
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should handle EXISTS subquery', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`
        SELECT * FROM users u
        WHERE EXISTS (
          SELECT 1 FROM posts p
          WHERE p.user_id = u.id AND p.published = ${true}
        )
      `)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users');
    expect(callback).toHaveBeenCalledTimes(1);

    manager.invalidate('posts');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should support changedIds parameter (for future use)', () => {
    const manager = new LiveQueryManager();
    const callback = vi.fn();

    const query = {
      toAst: () => rawQueryToAst(sql`SELECT * FROM users WHERE id = ${1}`)
    };

    manager.subscribe(query, callback);

    manager.invalidate('users', [1, 2, 3]);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});