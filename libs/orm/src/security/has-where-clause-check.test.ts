import { describe, it, expect } from 'vitest';
import { sql } from '../utils/sql';
import { hasWhereClauseCheck } from './has-where-clause-check';
import type { SecurityCheckContext } from '../schema/types';
import { analyze } from '../true-sql/analyze';

const evaluate = (
  rawSql: ReturnType<typeof sql>,
  securityCheck: SecurityCheckContext,
  message?: string
) => () => hasWhereClauseCheck(analyze(rawSql), securityCheck, message);

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
    it('allows queries containing the required security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when WHERE clause is missing the security check', () => {
      const query = sql`SELECT * FROM posts WHERE title = ${'something'}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('throws when WHERE clause is absent entirely', () => {
      const query = sql`SELECT * FROM posts`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing WHERE clause enforcing posts.user_id = 123 (table: posts)');
    });

    it('allows queries where AND conditions include the security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123} AND status = ${'published'}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when any OR branch omits the security check', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${123} OR title = ${'public'}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('allows OR branches when every branch contains the security check', () => {
      const query = sql`SELECT * FROM posts WHERE (user_id = ${123} AND status = ${'draft'}) OR (user_id = ${123} AND status = ${'published'})`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when nested OR branches miss the security check', () => {
      const query = sql`SELECT * FROM posts WHERE (user_id = ${123} AND status = ${'draft'}) OR (status = ${'published'} AND created_at > ${'2023-01-01'})`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('allows deeply nested parentheses with consistent security checks', () => {
      const query = sql`SELECT * FROM posts WHERE ((user_id = ${123} AND status = ${'draft'}) OR (user_id = ${123} AND priority = ${'high'})) AND category = ${'tech'}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('skips enforcement when the target table is not accessed', () => {
      const query = sql`SELECT * FROM comments WHERE post_id = ${456}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });
  });

  describe('UPDATE queries', () => {
    it('allows updates with the security check in WHERE clause', () => {
      const query = sql`UPDATE posts SET title = ${'updated'} WHERE user_id = ${123}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when UPDATE is missing the security check', () => {
      const query = sql`UPDATE posts SET title = ${'updated'} WHERE id = ${456}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('throws when UPDATE has no WHERE clause', () => {
      const query = sql`UPDATE posts SET title = ${'updated'}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing WHERE clause enforcing posts.user_id = 123 (table: posts)');
    });
  });

  describe('DELETE queries', () => {
    it('allows deletes with the security check', () => {
      const query = sql`DELETE FROM posts WHERE user_id = ${123}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when DELETE WHERE clause misses the security check', () => {
      const query = sql`DELETE FROM posts WHERE status = ${'draft'}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('throws when DELETE lacks a WHERE clause', () => {
      const query = sql`DELETE FROM posts`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing WHERE clause enforcing posts.user_id = 123');
    });
  });

  describe('INSERT queries', () => {
    it('ignores INSERT queries (no WHERE clause)', () => {
      const query = sql`INSERT INTO posts (title, user_id) VALUES (${'test'}, ${123})`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });
  });

  describe('Complex queries with joins and subqueries', () => {
    it('allows joins when WHERE clause enforces security', () => {
      const query = sql`SELECT p.*, u.name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ${123}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
    });

    it('throws when a subquery bypasses the security check', () => {
      const query = sql`SELECT * FROM posts WHERE id IN (SELECT post_id FROM comments WHERE author = ${'someone'})`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing WHERE clause enforcing posts.user_id = 123');
    });

    it('handles multiple tables with independent checks', () => {
      const query = sql`SELECT p.*, u.name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ${123} AND u.role = ${'admin'}`;
      expect(evaluate(query, userOwnershipCheck)).not.toThrow();
      expect(evaluate(query, adminCheck)).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('supports operators beyond equality', () => {
      const gtCheck: SecurityCheckContext = {
        tableName: 'posts',
        columnName: 'created_at',
        value: 1234567890,
        operator: '>'
      };

      const query = sql`SELECT * FROM posts WHERE created_at > ${1234567890}`;
      expect(evaluate(query, gtCheck)).not.toThrow();
    });

    it('supports null value comparisons', () => {
      const nullCheck: SecurityCheckContext = {
        tableName: 'posts',
        columnName: 'deleted_at',
        value: null,
        operator: '='
      };

      const query = sql`SELECT * FROM posts WHERE deleted_at = ${null}`;
      expect(evaluate(query, nullCheck)).not.toThrow();
    });

    it('throws when value does not match expectation', () => {
      const query = sql`SELECT * FROM posts WHERE user_id = ${456}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123 (table: posts)');
    });

    it('throws when operator does not match expectation', () => {
      const query = sql`SELECT * FROM posts WHERE user_id != ${123}`;
      expect(evaluate(query, userOwnershipCheck)).toThrow('Missing required filter posts.user_id = 123');
    });
  });
});
