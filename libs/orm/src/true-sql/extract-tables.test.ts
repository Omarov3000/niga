import { describe, it, expect } from 'vitest';
import { extractTables } from './extract-tables';
import { sql } from '../utils/sql';

describe('extractTables', () => {
  it('should extract table from simple query', () => {
    const tables = extractTables(sql`SELECT * FROM users WHERE id = ${1}`);
    expect(tables).toEqual(['users']);
  });

  it('should extract tables from joined query', () => {
    const tables = extractTables(sql`
      SELECT u.id, u.name, p.title
      FROM users u
      INNER JOIN posts p ON u.id = p.user_id
      WHERE u.active = ${true}
    `);
    expect(tables).toEqual(expect.arrayContaining(['users', 'posts']));
    expect(tables).toHaveLength(2);
  });

  it('should extract tables from recursive CTE query', () => {
    const tables = extractTables(sql`
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
    `);
    expect(tables).toEqual(expect.arrayContaining(['categories', 'category_tree']));
    expect(tables).toHaveLength(2);
  });

  it('should extract tables from complex select with subqueries', () => {
    const tables = extractTables(sql`
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
    `);
    expect(tables).toEqual(expect.arrayContaining(['users', 'posts', 'comments']));
    expect(tables).toHaveLength(3);
  });

  it('should extract tables from query with LEFT JOIN', () => {
    const tables = extractTables(sql`
      SELECT u.*, p.title
      FROM users u
      LEFT JOIN posts p ON u.id = p.user_id
    `);
    expect(tables).toEqual(expect.arrayContaining(['users', 'posts']));
    expect(tables).toHaveLength(2);
  });

  it('should extract tables from WITH clause (non-recursive CTE)', () => {
    const tables = extractTables(sql`
      WITH active_users AS (
        SELECT * FROM users WHERE active = ${true}
      )
      SELECT au.name, p.title
      FROM active_users au
      INNER JOIN posts p ON au.id = p.user_id
    `);
    expect(tables).toEqual(expect.arrayContaining(['users', 'active_users', 'posts']));
    expect(tables).toHaveLength(3);
  });

  it('should extract tables from EXISTS subquery', () => {
    const tables = extractTables(sql`
      SELECT * FROM users u
      WHERE EXISTS (
        SELECT 1 FROM posts p
        WHERE p.user_id = u.id AND p.published = ${true}
      )
    `);
    expect(tables).toEqual(expect.arrayContaining(['users', 'posts']));
    expect(tables).toHaveLength(2);
  });
});
