import { it, expect, describe } from "vitest";
import { rawQueryToSelectQuery } from './rawQueryToSelectQuery';
import { sql } from './sql';

describe("rawQueryToSelectQuery - unit tests", () => {
  describe("columns", () => {
    it("parses star column", () => {
      const result = rawQueryToSelectQuery(sql`SELECT * FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
      });
    });

    it("parses simple columns", () => {
      const result = rawQueryToSelectQuery(sql`SELECT id, name FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [
          { type: "column", name: "id" },
          { type: "column", name: "name" },
        ],
        from: { type: "table", name: "users" },
      });
    });

    it("parses column alias", () => {
      const result = rawQueryToSelectQuery(sql`SELECT id AS user_id FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "column", name: "id", alias: "user_id" }],
        from: { type: "table", name: "users" },
      });
    });

    it("parses table alias in column", () => {
      const result = rawQueryToSelectQuery(sql`SELECT u.id FROM users u`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "column", name: "id", table: "u" }],
        from: { type: "table", name: "users", alias: "u" },
      });
    });
  });

  describe("literals and params", () => {
    it("parses numeric literal", () => {
      const result = rawQueryToSelectQuery(sql`SELECT 42 FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "literal", value: 42 }],
        from: { type: "table", name: "users" },
      });
    });

    it("parses string param", () => {
      const result = rawQueryToSelectQuery(sql`SELECT ${"foo"} FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "param", index: 0 }],
        from: { type: "table", name: "users" },
      });
    });

    it("parses NULL literal", () => {
      const result = rawQueryToSelectQuery(sql`SELECT NULL FROM users`);
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "literal", value: null }],
        from: { type: "table", name: "users" },
      });
    });
  });

  describe("where clause - comparison operators", () => {
    it("parses =", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE id = ${1}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "binary_expr",
          operator: "=",
          left: { type: "column", name: "id" },
          right: { type: "param", index: 0 },
        },
      });
    });

    it("parses !=", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE name != ${"bob"}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "binary_expr",
          operator: "!=",
          left: { type: "column", name: "name" },
          right: { type: "param", index: 0 },
        },
      });
    });

    it("parses <", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE age < ${30}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "binary_expr",
          operator: "<",
          left: { type: "column", name: "age" },
          right: { type: "param", index: 0 },
        },
      });
    });

    it("parses <=", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE age <= ${40}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "binary_expr",
          operator: "<=",
          left: { type: "column", name: "age" },
          right: { type: "param", index: 0 },
        },
      });
    });

    it("parses >=", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE age >= ${18}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "binary_expr",
          operator: ">=",
          left: { type: "column", name: "age" },
          right: { type: "param", index: 0 },
        },
      });
    });
  });

  describe("where clause - logical operators", () => {
    it("parses AND", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE id = ${1} AND name != ${"bob"}`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "logical_expr",
          operator: "AND",
          left: {
            type: "binary_expr",
            operator: "=",
            left: { type: "column", name: "id" },
            right: { type: "param", index: 0 },
          },
          right: {
            type: "binary_expr",
            operator: "!=",
            left: { type: "column", name: "name" },
            right: { type: "param", index: 1 },
          },
        },
      });
    });

    it("parses OR", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE active = 1 OR admin = 1`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "logical_expr",
          operator: "OR",
          left: {
            type: "binary_expr",
            operator: "=",
            left: { type: "column", name: "active" },
            right: { type: "literal", value: 1 },
          },
          right: {
            type: "binary_expr",
            operator: "=",
            left: { type: "column", name: "admin" },
            right: { type: "literal", value: 1 },
          },
        },
      });
    });
  });

  describe("functions", () => {
    it("parses COUNT(*)", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT COUNT(*) AS total FROM users`
      );
      expect(result).toEqual({
        type: "select",
        columns: [
          {
            type: "function_call",
            name: "COUNT",
            args: [{ type: "star" }],
            alias: "total",
          },
        ],
        from: { type: "table", name: "users" },
      });
    });
  });

  describe("joins", () => {
    it("parses INNER JOIN", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT u.id, o.id FROM users u INNER JOIN orders o ON u.id = o.user_id`
      );
      expect(result).toEqual({
        type: "select",
        columns: [
          { type: "column", name: "id", table: "u" },
          { type: "column", name: "id", table: "o" },
        ],
        from: {
          type: "join",
          joinType: "INNER",
          left: { type: "table", name: "users", alias: "u" },
          right: { type: "table", name: "orders", alias: "o" },
          on: {
            type: "binary_expr",
            operator: "=",
            left: { type: "column", name: "id", table: "u" },
            right: { type: "column", name: "user_id", table: "o" },
          },
        },
      });
    });

    it("parses CROSS JOIN", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users CROSS JOIN roles`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: {
          type: "join",
          joinType: "CROSS",
          left: { type: "table", name: "users" },
          right: { type: "table", name: "roles" },
        },
      });
    });
  });

  describe("subqueries", () => {
    it("parses scalar subquery", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT (SELECT COUNT(*) FROM orders) AS order_count FROM users`
      );
      expect(result).toEqual({
        type: "select",
        columns: [
          {
            type: "subquery",
            query: {
              type: "select",
              columns: [
                { type: "function_call", name: "COUNT", args: [{ type: "star" }] },
              ],
              from: { type: "table", name: "orders" },
            },
            alias: "order_count",
          },
        ],
        from: { type: "table", name: "users" },
      });
    });

    it("parses IN subquery", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "in_subquery",
          expr: { type: "column", name: "id" },
          query: {
            type: "select",
            columns: [{ type: "column", name: "user_id" }],
            from: { type: "table", name: "orders" },
          },
        },
      });
    });

    it("parses EXISTS subquery", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders)`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        where: {
          type: "exists_subquery",
          query: {
            type: "select",
            columns: [{ type: "literal", value: 1 }],
            from: { type: "table", name: "orders" },
          },
        },
      });
    });
  });

  describe("from subquery", () => {
    it("parses FROM (subquery)", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM (SELECT id FROM users) sub`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: {
          type: "from_subquery",
          query: {
            type: "select",
            columns: [{ type: "column", name: "id" }],
            from: { type: "table", name: "users" },
          },
          alias: "sub",
        },
      });
    });
  });

  describe("group by / having", () => {
    it("parses GROUP BY and HAVING", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1`
      );
      expect(result).toEqual({
        type: "select",
        columns: [
          { type: "column", name: "user_id" },
          { type: "function_call", name: "COUNT", args: [{ type: "star" }] },
        ],
        from: { type: "table", name: "orders" },
        groupBy: [{ type: "column", name: "user_id" }],
        having: {
          type: "binary_expr",
          operator: ">",
          left: { type: "function_call", name: "COUNT", args: [{ type: "star" }] },
          right: { type: "literal", value: 1 },
        },
      });
    });
  });

  describe("order by / limit", () => {
    it("parses ORDER BY", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users ORDER BY name DESC, id ASC`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        orderBy: [
          { expr: { type: "column", name: "name" }, direction: "DESC" },
          { expr: { type: "column", name: "id" }, direction: "ASC" },
        ],
      });
    });

    it("parses LIMIT and OFFSET", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT * FROM users LIMIT 10 OFFSET 5`
      );
      expect(result).toEqual({
        type: "select",
        columns: [{ type: "star" }],
        from: { type: "table", name: "users" },
        limit: { limit: 10, offset: 5 },
      });
    });
  });

  describe("with clause (CTE)", () => {
    it("parses simple CTE", () => {
      const result = rawQueryToSelectQuery(
        sql`WITH recent AS (SELECT * FROM orders) SELECT * FROM recent`
      );
      expect(result).toEqual({
        type: "select",
        with: {
          recursive: false,
          ctes: [
            {
              type: "cte",
              name: "recent",
              select: {
                type: "select",
                columns: [{ type: "star" }],
                from: { type: "table", name: "orders" },
              },
            },
          ],
        },
        columns: [{ type: "star" }],
        from: { type: "table", name: "recent" },
      });
    });
  });

  describe("compound select", () => {
    it("parses UNION", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT id FROM users UNION SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "compound_select",
        left: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "users" },
        },
        operator: "UNION",
        right: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "admins" },
        },
      });
    });

    it("parses UNION ALL", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT id FROM users UNION ALL SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "compound_select",
        left: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "users" },
        },
        operator: "UNION ALL",
        right: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "admins" },
        },
      });
    });

    it("parses INTERSECT", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT id FROM users INTERSECT SELECT id FROM admins`
      );
      expect(result).toEqual({
        type: "compound_select",
        left: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "users" },
        },
        operator: "INTERSECT",
        right: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "admins" },
        },
      });
    });

    it("parses EXCEPT", () => {
      const result = rawQueryToSelectQuery(
        sql`SELECT id FROM users EXCEPT SELECT id FROM banned_users`
      );
      expect(result).toEqual({
        type: "compound_select",
        left: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "users" },
        },
        operator: "EXCEPT",
        right: {
          type: "select",
          columns: [{ type: "column", name: "id" }],
          from: { type: "table", name: "banned_users" },
        },
      });
    });
  });
});


describe("rawQueryToSelectQuery - integration tests", () => {
  it("parses query with join + where + group by + having + order by + limit", () => {
    const result = rawQueryToSelectQuery(sql`
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
      columns: [
        { type: "column", name: "id", table: "u" },
        {
          type: "function_call",
          name: "COUNT",
          args: [{ type: "column", name: "id", table: "o" }],
          alias: "order_count",
        },
      ],
      from: {
        type: "join",
        joinType: "LEFT",
        left: { type: "table", name: "users", alias: "u" },
        right: { type: "table", name: "orders", alias: "o" },
        on: {
          type: "binary_expr",
          operator: "=",
          left: { type: "column", name: "id", table: "u" },
          right: { type: "column", name: "user_id", table: "o" },
        },
      },
      where: {
        type: "binary_expr",
        operator: "=",
        left: { type: "column", name: "active", table: "u" },
        right: { type: "literal", value: 1 },
      },
      groupBy: [{ type: "column", name: "id", table: "u" }],
      having: {
        type: "binary_expr",
        operator: ">",
        left: {
          type: "function_call",
          name: "COUNT",
          args: [{ type: "column", name: "id", table: "o" }],
        },
        right: { type: "literal", value: 2 },
      },
      orderBy: [
        { expr: { type: "column", name: "order_count" }, direction: "DESC" },
      ],
      limit: { limit: 10, offset: 5 },
    });
  });

  it("parses query with CTE + subquery + compound select", () => {
    const result = rawQueryToSelectQuery(sql`
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
      type: "compound_select",
      with: {
        recursive: false,
        ctes: [
          {
            type: "cte",
            name: "active_users",
            select: {
              type: "select",
              columns: [{ type: "star" }],
              from: { type: "table", name: "users" },
              where: {
                type: "binary_expr",
                operator: "=",
                left: { type: "column", name: "active" },
                right: { type: "literal", value: 1 },
              },
            },
          },
        ],
      },
      left: {
        type: "select",
        columns: [{ type: "column", name: "id" }],
        from: { type: "table", name: "active_users" },
      },
      operator: "UNION ALL",
      right: {
        type: "select",
        columns: [{ type: "column", name: "id" }],
        from: { type: "table", name: "admins" },
        where: {
          type: "exists_subquery",
          query: {
            type: "select",
            columns: [{ type: "literal", value: 1 }],
            from: { type: "table", name: "roles" },
            where: {
              type: "binary_expr",
              operator: "=",
              left: { type: "column", name: "user_id", table: "roles" },
              right: { type: "column", name: "id", table: "admins" },
            },
          },
        },
      },
      orderBy: [
        { expr: { type: "column", name: "id" }, direction: "DESC" },
      ],
      limit: { limit: 3 },
    });
  });
});
