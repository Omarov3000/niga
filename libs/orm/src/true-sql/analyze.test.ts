import { describe, it, expect } from "vitest";
import { sql } from "../utils/sql";
import { analyze } from './analyze';

describe("analyze - unit tests", () => {
  describe("columns & tables", () => {
    it("extracts simple columns", () => {
      const result = analyze(sql`SELECT id, name FROM users`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id", "name"], filterBranches: [[]] },
        ],
      });
    });

    it("extracts star column", () => {
      const result = analyze(sql`SELECT * FROM users`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [{ name: "users", columns: [], filterBranches: [[]] }],
      });
    });

    it("resolves column alias", () => {
      const result = analyze(sql`SELECT id AS user_id FROM users`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [{ name: "users", columns: ["id"], filterBranches: [[]] }],
      });
    });

    it("resolves table alias", () => {
      const result = analyze(sql`SELECT u.id FROM users u`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [{ name: "users", columns: ["id"], filterBranches: [[]] }],
      });
    });
  });

  describe("filters", () => {
    it("handles simple comparison with literal", () => {
      const result = analyze(sql`SELECT * FROM users WHERE age > 18`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "users",
            columns: ["age"],
            filterBranches: [[{ column: "age", operator: ">", value: 18 }]],
          },
        ],
      });
    });

    it("handles comparison with param", () => {
      const result = analyze(sql`SELECT * FROM users WHERE name = ${"bob"}`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "users",
            columns: ["name"],
            filterBranches: [[{ column: "name", operator: "=", value: "bob" }]],
          },
        ],
      });
    });

    it("handles multiple filters with AND", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE age >= ${18} AND active = 1`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "users",
            columns: ["age", "active"],
            filterBranches: [[
              { column: "age", operator: ">=", value: 18 },
              { column: "active", operator: "=", value: 1 },
            ]],
          },
        ],
      });
    });

    it("handles OR filters", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE age < 18 OR active = 1`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "users",
            columns: ["age", "active"],
            filterBranches: [
              [{ column: "age", operator: "<", value: 18 }],
              [{ column: "active", operator: "=", value: 1 }],
            ],
          },
        ],
      });
    });

    it("handles filters with table alias", () => {
      const result = analyze(sql`SELECT * FROM users u WHERE u.id = 1`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "users",
            columns: ["id"],
            filterBranches: [[{ column: "id", operator: "=", value: 1 }]],
          },
        ],
      });
    });
  });

  describe("joins", () => {
    it("handles INNER JOIN with ON", () => {
      const result = analyze(
        sql`SELECT u.id, o.id FROM users u INNER JOIN orders o ON u.id = o.user_id`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "orders", columns: ["id", "user_id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles LEFT JOIN with ON", () => {
      const result = analyze(
        sql`SELECT u.id, o.id FROM users u LEFT JOIN orders o ON u.id = o.user_id`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "orders", columns: ["id", "user_id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles CROSS JOIN", () => {
      const result = analyze(sql`SELECT * FROM users CROSS JOIN roles`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: [], filterBranches: [[]] },
          { name: "roles", columns: [], filterBranches: [[]] },
        ],
      });
    });

    it("handles join with multiple ON conditions", () => {
      const result = analyze(
        sql`SELECT * FROM users u JOIN orders o ON u.id = o.user_id AND o.active = 1`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          {
            name: "orders",
            columns: ["user_id", "active"],
            filterBranches: [[{ column: "active", operator: "=", value: 1 }]],
          },
        ],
      });
    });
  });

  describe("subqueries", () => {
    it("handles scalar subquery in SELECT", () => {
      const result = analyze(
        sql`SELECT (SELECT COUNT(*) FROM orders) AS order_count FROM users`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "orders", columns: [], filterBranches: [[]] },
          { name: "users", columns: [], filterBranches: [[]] },
        ],
      });
    });

    it("handles IN subquery in WHERE", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "orders", columns: ["user_id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles EXISTS subquery in WHERE", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders)`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: [], filterBranches: [[]] },
          { name: "orders", columns: [], filterBranches: [[]] },
        ],
      });
    });

    it("handles subquery in FROM", () => {
      const result = analyze(sql`SELECT * FROM (SELECT id FROM users) sub`);
      expect(result).toEqual({
        type: "select",
        accessedTables: [{ name: "users", columns: ["id"], filterBranches: [[]] }],
      });
    });
  });

  describe("aggregation", () => {
    it("handles GROUP BY", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "orders", columns: ["user_id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles HAVING with literal", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "orders",
            columns: ["user_id"],
            filterBranches: [[{ column: "user_id", operator: ">", value: 1 }]],
          },
        ],
      });
    });

    it("handles HAVING with param", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > ${2}`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          {
            name: "orders",
            columns: ["user_id"],
            filterBranches: [[{ column: "user_id", operator: ">", value: 2 }]],
          },
        ],
      });
    });
  });

  describe("compound queries", () => {
    it("handles UNION", () => {
      const result = analyze(
        sql`SELECT id FROM users UNION SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "admins", columns: ["id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles UNION ALL", () => {
      const result = analyze(
        sql`SELECT id FROM users UNION ALL SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "admins", columns: ["id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles INTERSECT", () => {
      const result = analyze(
        sql`SELECT id FROM users INTERSECT SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "admins", columns: ["id"], filterBranches: [[]] },
        ],
      });
    });

    it("handles EXCEPT", () => {
      const result = analyze(
        sql`SELECT id FROM users EXCEPT SELECT id FROM banned_users`
      );
      expect(result).toEqual({
        type: "select",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[]] },
          { name: "banned_users", columns: ["id"], filterBranches: [[]] },
        ],
      });
    });
  });
});

describe("analyze - integration tests", () => {
  it("handles join + where + group by + having + order by + limit", () => {
    const result = analyze(sql`
      SELECT u.id, COUNT(o.id) AS order_count
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.active = 1
      GROUP BY u.id
      HAVING COUNT(o.id) > 2
      ORDER BY order_count DESC
      LIMIT 10 OFFSET 5
    `);

    expect(result).toEqual({
      type: "select",
      accessedTables: [
        {
          name: "users",
          columns: ["id", "active"],
          filterBranches: [[{ column: "active", operator: "=", value: 1 }]],
        },
        {
          name: "orders",
          columns: ["id", "user_id"],
          filterBranches: [[{ column: "id", operator: ">", value: 2 }]],
        },
      ],
    });
  });

  it("handles CTE + subquery + compound select", () => {
    const result = analyze(sql`
      WITH active_users AS (
        SELECT * FROM users WHERE active = 1
      )
      SELECT id FROM active_users
      UNION ALL
      SELECT id FROM admins WHERE EXISTS (
        SELECT 1 FROM roles WHERE roles.user_id = admins.id
      )
      ORDER BY id DESC
      LIMIT 3
    `);

    expect(result).toEqual({
      type: "select",
      accessedTables: [
        {
          name: "users",
          columns: ["active"],
          filterBranches: [[{ column: "active", operator: "=", value: 1 }]],
        },
        { name: "admins", columns: ["id"], filterBranches: [[]] },
        { name: "roles", columns: ["user_id", "id"], filterBranches: [[]] },
      ],
    });
  });

  it("handles nested subqueries", () => {
    const result = analyze(sql`
      SELECT * FROM users
      WHERE id IN (
        SELECT user_id FROM orders
        WHERE order_id IN (
          SELECT id FROM shipments WHERE status = 'delivered'
        )
      )
    `);

    expect(result).toEqual({
      type: "select",
      accessedTables: [
        { name: "users", columns: ["id"], filterBranches: [[]] },
        { name: "orders", columns: ["user_id", "order_id"], filterBranches: [[]] },
        {
          name: "shipments",
          columns: ["id", "status"],
          filterBranches: [[{ column: "status", operator: "=", value: "delivered" }]],
        },
      ],
    });
  });

  it("handles multiple joins and filters across tables", () => {
    const result = analyze(sql`
      SELECT u.id, o.id, p.id
      FROM users u
      JOIN orders o ON u.id = o.user_id
      JOIN payments p ON o.id = p.order_id
      WHERE u.active = 1 AND p.status = 'paid'
    `);

    expect(result).toEqual({
      type: "select",
      accessedTables: [
        {
          name: "users",
          columns: ["id", "active"],
          filterBranches: [[{ column: "active", operator: "=", value: 1 }]],
        },
        { name: "orders", columns: ["id", "user_id"], filterBranches: [[]] },
        {
          name: "payments",
          columns: ["id", "order_id", "status"],
          filterBranches: [[{ column: "status", operator: "=", value: "paid" }]],
        },
      ],
    });
  });

  describe("INSERT, UPDATE, DELETE queries", () => {
    it("extracts table from INSERT query", () => {
      const result = analyze(sql`INSERT INTO users (name, email) VALUES (${'John'}, ${'john@example.com'})`);
      expect(result).toEqual({
        type: "insert",
        accessedTables: [
          { name: "users", columns: [], filterBranches: [[]] }
        ],
      });
    });

    it("extracts table from UPDATE query", () => {
      const result = analyze(sql`UPDATE users SET name = ${'Jane'} WHERE id = ${123}`);
      expect(result).toEqual({
        type: "update",
        accessedTables: [
          { name: "users", columns: ["id"], filterBranches: [[{ column: "id", operator: "=", value: 123 }]] }
        ],
      });
    });

    it("extracts table from DELETE query", () => {
      const result = analyze(sql`DELETE FROM users WHERE active = ${null}`);
      expect(result).toEqual({
        type: "delete",
        accessedTables: [
          { name: "users", columns: ["active"], filterBranches: [[{ column: "active", operator: "=", value: null }]] }
        ],
      });
    });

    it("handles UPDATE with complex WHERE clause", () => {
      const result = analyze(sql`UPDATE posts SET title = ${'Updated'} WHERE user_id = ${1} AND status = ${'draft'}`);
      expect(result).toEqual({
        type: "update",
        accessedTables: [
          { name: "posts", columns: ["user_id", "status"], filterBranches: [[{ column: "user_id", operator: "=", value: 1 }, { column: "status", operator: "=", value: "draft" }]] }
        ],
      });
    });

    it("handles DELETE with JOIN-like subquery", () => {
      const result = analyze(sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${456})`);
      expect(result).toEqual({
        type: "delete",
        accessedTables: [
          { name: "comments", columns: ["post_id"], filterBranches: [[]] },
          { name: "posts", columns: ["id", "user_id"], filterBranches: [[{ column: "user_id", operator: "=", value: 456 }]] }
        ],
      });
    });

    it("handles INSERT with SELECT subquery", () => {
      const result = analyze(sql`INSERT INTO audit_log (user_id, event_type) SELECT id, ${'login'} FROM users WHERE last_login > ${new Date('2023-01-01').getTime()}`);
      // INSERT with SELECT is not fully implemented yet - just expect the INSERT table
      expect(result).toEqual({
        type: "insert",
        accessedTables: [
          { name: "audit_log", columns: [], filterBranches: [[]] }
        ],
      });
    });
  });
});
