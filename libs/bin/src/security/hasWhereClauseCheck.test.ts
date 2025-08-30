import { describe, it, expect } from 'vitest';
import { sql } from '../utils/sql';
import { hasWhereClauseCheck } from './hasWhereClauseCheck';
import type { SecurityCheckContext } from '../types';

describe('hasWhereClauseCheck', () => {
  const userOwnershipCheck: SecurityCheckContext = {
    tableName: 'posts',
    columnName: 'user_id',
    value: 123,
    operator: '='
  };

  const adminCheck: SecurityCheckContext = {
    tableName: 'users',
    columnName: 'role',
    value: 'admin',
    operator: '='
  };

  describe('SELECT queries', () => {
    it('returns true when WHERE clause contains the required security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when WHERE clause is missing the security check', () => {
      const query = sql`SELECT * FROM posts WHERE title = ${'something'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns false when there is no WHERE clause at all', () => {
      const query = sql`SELECT * FROM posts`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns true when AND condition includes the security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123} AND status = ${'published'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when OR condition has branches without security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123} OR title = ${'public'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns true when all OR branches contain the security check (complex parentheses handling)', () => {
      const query = sql`SELECT * FROM posts WHERE (user_id = ${123} AND status = ${'draft'}) OR (user_id = ${123} AND status = ${'published'})`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when one OR branch is missing the security check (complex parentheses)', () => {
      const query = sql`SELECT * FROM posts WHERE (user_id = ${123} AND status = ${'draft'}) OR (status = ${'published'} AND created_at > ${'2023-01-01'})`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns true for deeply nested parentheses with consistent security checks', () => {
      const query = sql`SELECT * FROM posts WHERE ((user_id = ${123} AND status = ${'draft'}) OR (user_id = ${123} AND priority = ${'high'})) AND category = ${'tech'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns true when table is not accessed', () => {
      const query = sql`SELECT * FROM comments WHERE post_id = ${456}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true); // posts table not accessed, so no check needed
    });
  });

  describe('UPDATE queries', () => {
    it('returns true when UPDATE WHERE clause contains security check', () => {
      const query = sql`UPDATE posts SET title = ${'updated'} WHERE user_id = ${123}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when UPDATE WHERE clause misses security check', () => {
      const query = sql`UPDATE posts SET title = ${'updated'} WHERE id = ${456}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns false when UPDATE has no WHERE clause', () => {
      const query = sql`UPDATE posts SET title = ${'updated'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });
  });

  describe('DELETE queries', () => {
    it('returns true when DELETE WHERE clause contains security check', () => {
      const query = sql`DELETE FROM posts WHERE user_id = ${123}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when DELETE WHERE clause misses security check', () => {
      const query = sql`DELETE FROM posts WHERE status = ${'draft'}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('returns false when DELETE has no WHERE clause', () => {
      const query = sql`DELETE FROM posts`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });
  });

  describe('INSERT queries', () => {
    it('returns true for INSERT queries (no WHERE clause analysis needed)', () => {
      const query = sql`INSERT INTO posts (title, user_id) VALUES (${'test'}, ${123})`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true); // INSERT doesn't have WHERE clause to check
    });
  });

  describe('Complex queries with joins and subqueries', () => {
    it('returns true when JOIN includes security check in WHERE', () => {
      const query = sql`SELECT p.*, u.name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ${123}`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(true);
    });

    it('returns false when subquery bypasses security check', () => {
      const query = sql`SELECT * FROM posts WHERE id IN (SELECT post_id FROM comments WHERE author = ${'someone'})`;
      const result = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(result).toBe(false);
    });

    it('handles multiple tables with different security checks', () => {
      const query = sql`SELECT p.*, u.name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ${123} AND u.role = ${'admin'}`;
      
      // Check posts table security
      const postsResult = hasWhereClauseCheck(query, userOwnershipCheck);
      expect(postsResult).toBe(true);
      
      // Check users table security
      const usersResult = hasWhereClauseCheck(query, adminCheck);
      expect(usersResult).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('handles different operators correctly', () => {
      const gtCheck: SecurityCheckContext = {
        tableName: 'posts',
        columnName: 'created_at',
        value: 1234567890,
        operator: '>'
      };
      
      const query = sql`SELECT * FROM posts WHERE created_at > ${1234567890}`;
      const result = hasWhereClauseCheck(query, gtCheck);
      expect(result).toBe(true);
    });

    it('handles null values in security checks', () => {
      const nullCheck: SecurityCheckContext = {
        tableName: 'posts',
        columnName: 'deleted_at',
        value: null,
        operator: '='
      };
      
      const query = sql`SELECT * FROM posts WHERE deleted_at = ${null}`;
      const result = hasWhereClauseCheck(query, nullCheck);
      expect(result).toBe(true);
    });

    it('returns false when value does not match', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${456}`; // Different user ID
      const result = hasWhereClauseCheck(query, userOwnershipCheck); // Expects user_id = 123
      expect(result).toBe(false);
    });

    it('returns false when operator does not match', () => {
      const query = sql`SELECT * FROM posts WHERE user_id != ${123}`; // Different operator
      const result = hasWhereClauseCheck(query, userOwnershipCheck); // Expects user_id = 123
      expect(result).toBe(false);
    });
  });
});