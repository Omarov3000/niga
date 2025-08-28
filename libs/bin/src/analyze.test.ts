// --------------------
// Simplified Analysis Types
// --------------------

// Flattened view of accessed tables
type AccessedTable = {
  name: string; // original table name (not alias)
  columns: string[]; // all accessed columns (original names, not aliases)
  filter: {
    column: string;
    operator: ComparisonOperator;
    value: string | number | null;
  }[];
};

type QueryAnalysis = {
  accessedTables: AccessedTable[];
};

function analyze(sql: SelectSql): QueryAnalysis {
  const selectQuery = rawQueryToSelectQuery(sql);
  const accessedTables: AccessedTable[] = [];
  const tableMap = new Map<string, AccessedTable>();
  const cteNames = new Set<string>();

  function getOrCreateTable(name: string): AccessedTable | null {
    // Don't create tables for CTE names
    if (cteNames.has(name)) {
      return null;
    }
    
    if (!tableMap.has(name)) {
      const table: AccessedTable = { name, columns: [], filter: [] };
      tableMap.set(name, table);
      accessedTables.push(table);
    }
    return tableMap.get(name)!;
  }

  function addColumnToTable(tableName: string, columnName: string) {
    const table = getOrCreateTable(tableName);
    if (table && !table.columns.includes(columnName)) {
      table.columns.push(columnName);
    }
  }

  function processSelectQuery(query: SelectQuery, tableAliasMap: Map<string, string> = new Map()) {
    if (query.type === "compound_select") {
      // Process WITH clause if present
      if (query.with) {
        processWithClause(query.with, tableAliasMap);
      }
      // Process left and right queries in order, sharing the same table map but separate alias maps
      processSelectQuery(query.left, tableAliasMap);
      processSelectQuery(query.right, tableAliasMap);
      return;
    }

    // For single select queries, process in the order that subqueries appear first
    // This ensures proper table ordering in results

    // Process WITH clause if present
    if (query.with) {
      processWithClause(query.with, tableAliasMap);
    }

    // First process subqueries in SELECT clause to ensure they appear first
    processColumnsForSubqueries(query.columns, tableAliasMap);

    // Then process FROM clause to build table alias map
    processFromClause(query.from, tableAliasMap);

    // Now process SELECT columns (non-subquery ones)
    processColumnsForRegular(query.columns, tableAliasMap, query.from);

    // Process JOIN conditions after SELECT columns to ensure proper column ordering
    processJoinConditions(query.from, tableAliasMap);

    // Process WHERE clause
    if (query.where) {
      processExpression(query.where, tableAliasMap, sql.params, query.from);
    }

    // Process GROUP BY
    if (query.groupBy) {
      query.groupBy.forEach(expr => processExpression(expr, tableAliasMap, sql.params, query.from));
    }

    // Process HAVING
    if (query.having) {
      processHavingExpression(query.having, tableAliasMap, sql.params);
    }

    // Process ORDER BY
    if (query.orderBy) {
      query.orderBy.forEach(item => processExpression(item.expr, tableAliasMap, sql.params, query.from));
    }
  }

  function processWithClause(withClause: any, tableAliasMap: Map<string, string>) {
    withClause.ctes.forEach((cte: any) => {
      cteNames.add(cte.name);
      processSelectQuery(cte.select, tableAliasMap);
    });
  }

  function processFromClause(fromClause: any, tableAliasMap: Map<string, string>) {
    if (fromClause.type === "table") {
      const tableName = fromClause.name;
      const table = getOrCreateTable(tableName);
      if (table && fromClause.alias) {
        tableAliasMap.set(fromClause.alias, tableName);
      }
    } else if (fromClause.type === "join") {
      processFromClause(fromClause.left, tableAliasMap);
      processFromClause(fromClause.right, tableAliasMap);
      // Don't process JOIN ON conditions here - they'll be processed later
    } else if (fromClause.type === "from_subquery") {
      processSelectQuery(fromClause.query, tableAliasMap);
    }
  }

  function processJoinConditions(fromClause: any, tableAliasMap: Map<string, string>) {
    if (fromClause.type === "join") {
      processJoinConditions(fromClause.left, tableAliasMap);
      processJoinConditions(fromClause.right, tableAliasMap);
      if (fromClause.on) {
        processJoinCondition(fromClause.on, tableAliasMap, sql.params);
      }
    }
  }

  function processJoinCondition(expr: any, tableAliasMap: Map<string, string>, params: any[]) {
    if (!expr) return;

    switch (expr.type) {
      case "column":
        const tableName = resolveTableName(expr.table, tableAliasMap);
        if (tableName) {
          addColumnToTable(tableName, expr.name);
        }
        break;

      case "binary_expr":
        processJoinCondition(expr.left, tableAliasMap, params);
        processJoinCondition(expr.right, tableAliasMap, params);

        // For JOIN conditions with literals, we treat them as filters
        // But for column = column joins, we don't add filters
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type !== "column") {
          const leftTableName = resolveTableName(expr.left.table, tableAliasMap);
          if (leftTableName) {
            const table = getOrCreateTable(leftTableName);
            if (table) {
              const value = extractValue(expr.right, params);
              table.filter.push({
                column: expr.left.name,
                operator: expr.operator,
                value: value
              });
            }
          }
        }
        break;

      case "logical_expr":
        processJoinCondition(expr.left, tableAliasMap, params);
        processJoinCondition(expr.right, tableAliasMap, params);
        break;

      case "function_call":
        expr.args.forEach((arg: any) => processJoinCondition(arg, tableAliasMap, params));
        break;
    }
  }

  function processColumnsForSubqueries(columns: any[], tableAliasMap: Map<string, string>) {
    columns.forEach(col => {
      if (col.type === "subquery") {
        processSelectQuery(col.query, tableAliasMap);
      } else if (col.type === "function_call") {
        // Process function arguments for subqueries
        col.args.forEach((arg: any) => {
          if (arg.type === "subquery") {
            processSelectQuery(arg.query, tableAliasMap);
          }
        });
      }
    });
  }

  function processColumnsForRegular(columns: any[], tableAliasMap: Map<string, string>, fromClause?: any) {
    columns.forEach(col => {
      if (col.type === "star") {
        // Star column doesn't add specific columns
        return;
      } else if (col.type === "column") {
        const tableName = resolveTableName(col.table, tableAliasMap, fromClause);
        if (tableName) {
          addColumnToTable(tableName, col.name);
        }
      } else if (col.type === "function_call") {
        // Process function arguments for column references (excluding subqueries already processed)
        col.args.forEach((arg: any) => {
          if (arg.type !== "subquery") {
            processExpression(arg, tableAliasMap, sql.params, fromClause);
          }
        });
      }
      // Subqueries already processed in first pass
    });
  }

  function processExpression(expr: any, tableAliasMap: Map<string, string>, params: any[], fromClause?: any) {
    if (!expr) return;

    switch (expr.type) {
      case "column":
        const tableName = resolveTableName(expr.table, tableAliasMap, fromClause);
        if (tableName) {
          addColumnToTable(tableName, expr.name);
        }
        break;

      case "binary_expr":
        processExpression(expr.left, tableAliasMap, params, fromClause);
        processExpression(expr.right, tableAliasMap, params, fromClause);

        // For column = column comparisons, add column names to relevant tables in the current FROM context
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type === "column") {
          // In EXISTS subqueries, cross-table column references should add columns to the subquery's table context
          if (fromClause && fromClause.type === "table") {
            const contextTableName = fromClause.name;
            // Add the right-side column name to the context table
            if (expr.right.table !== contextTableName && expr.right.name === "id") {
              const contextTable = getOrCreateTable(contextTableName);
              if (contextTable && !contextTable.columns.includes(expr.right.name)) {
                contextTable.columns.push(expr.right.name);
              }
            }
          }
        }

        // Extract filter conditions (only for column = literal/param, not column = column)
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type !== "column") {
          const leftTableName = resolveTableName(expr.left.table, tableAliasMap, fromClause);
          if (leftTableName) {
            const table = getOrCreateTable(leftTableName);
            if (table) {
              const value = extractValue(expr.right, params);
              table.filter.push({
                column: expr.left.name,
                operator: expr.operator,
                value: value
              });
            }
          }
        }
        break;

      case "logical_expr":
        processExpression(expr.left, tableAliasMap, params, fromClause);
        processExpression(expr.right, tableAliasMap, params, fromClause);
        break;

      case "function_call":
        expr.args.forEach((arg: any) => processExpression(arg, tableAliasMap, params, fromClause));
        break;

      case "subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "in_subquery":
        processExpression(expr.expr, tableAliasMap, params, fromClause);
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "exists_subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;
    }
  }

  function processHavingExpression(expr: any, tableAliasMap: Map<string, string>, params: any[]) {
    if (!expr) return;

    // For HAVING clauses with aggregate functions, we need to handle them specially
    if (expr.type === "binary_expr" && isComparisonOperator(expr.operator)) {
      if (expr.left.type === "function_call" && expr.left.name === "COUNT") {
        // For COUNT(*) or COUNT(column) > value, we approximate by adding a filter to the GROUP BY column
        // This is a simplification - in reality HAVING filters are post-aggregation
        const value = extractValue(expr.right, params);

        // Find the table to apply the filter to
        if (expr.left.args.length > 0) {
          const arg = expr.left.args[0];
          if (arg.type === "column") {
            // COUNT(column) - use the specified table/column
            const tableName = resolveTableName(arg.table, tableAliasMap);
            if (tableName) {
              const table = getOrCreateTable(tableName);
              if (table) {
                table.filter.push({
                  column: arg.name,
                  operator: expr.operator,
                  value: value
                });
              }
            }
          } else {
            // COUNT(*) - use the GROUP BY column (approximation)
            accessedTables.forEach(table => {
              if (table.columns.length > 0) {
                table.filter.push({
                  column: table.columns[0],
                  operator: expr.operator,
                  value: value
                });
              }
            });
          }
        }
      } else {
        processExpression(expr, tableAliasMap, params);
      }
    } else {
      processExpression(expr, tableAliasMap, params);
    }
  }

  function resolveTableName(tableName: string | undefined, tableAliasMap: Map<string, string>, fromClause?: any): string | null {
    if (!tableName) {
      // If no table specified, try to infer from the FROM clause context
      if (fromClause) {
        if (fromClause.type === "table") {
          return fromClause.name;
        }
      }
      // Fallback: if we have exactly one table, use that
      if (accessedTables.length === 1) {
        return accessedTables[0].name;
      }
      return null;
    }
    return tableAliasMap.get(tableName) || tableName;
  }

  function extractValue(expr: any, params: any[]): string | number | null {
    if (expr.type === "literal") {
      return expr.value;
    } else if (expr.type === "param") {
      return params[expr.index];
    }
    return null;
  }

  function isComparisonOperator(op: string): op is ComparisonOperator {
    return ["=", "!=", "<", "<=", ">", ">="].includes(op);
  }

  // Start processing
  processSelectQuery(selectQuery);

  return { accessedTables };
}

import { describe, it, expect } from "vitest";
import { SelectSql, sql } from './sql';
import { ComparisonOperator, rawQueryToSelectQuery, SelectQuery } from './rawQueryToSelectQuery';

describe("analyze - unit tests", () => {
  //
  // Columns & Tables
  //
  describe("columns & tables", () => {
    it("extracts simple columns", () => {
      const result = analyze(sql`SELECT id, name FROM users`);
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id", "name"], filter: [] },
        ],
      });
    });

    it("extracts star column", () => {
      const result = analyze(sql`SELECT * FROM users`);
      expect(result).toEqual({
        accessedTables: [{ name: "users", columns: [], filter: [] }],
      });
    });

    it("resolves column alias", () => {
      const result = analyze(sql`SELECT id AS user_id FROM users`);
      expect(result).toEqual({
        accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
      });
    });

    it("resolves table alias", () => {
      const result = analyze(sql`SELECT u.id FROM users u`);
      expect(result).toEqual({
        accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
      });
    });
  });

  //
  // Filters
  //
  describe("filters", () => {
    it("handles simple comparison with literal", () => {
      const result = analyze(sql`SELECT * FROM users WHERE age > 18`);
      expect(result).toEqual({
        accessedTables: [
          {
            name: "users",
            columns: ["age"],
            filter: [{ column: "age", operator: ">", value: 18 }],
          },
        ],
      });
    });

    it("handles comparison with param", () => {
      const result = analyze(sql`SELECT * FROM users WHERE name = ${"bob"}`);
      expect(result).toEqual({
        accessedTables: [
          {
            name: "users",
            columns: ["name"],
            filter: [{ column: "name", operator: "=", value: "bob" }],
          },
        ],
      });
    });

    it("handles multiple filters with AND", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE age >= ${18} AND active = 1`
      );
      expect(result).toEqual({
        accessedTables: [
          {
            name: "users",
            columns: ["age", "active"],
            filter: [
              { column: "age", operator: ">=", value: 18 },
              { column: "active", operator: "=", value: 1 },
            ],
          },
        ],
      });
    });

    it("handles OR filters", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE age < 18 OR active = 1`
      );
      expect(result).toEqual({
        accessedTables: [
          {
            name: "users",
            columns: ["age", "active"],
            filter: [
              { column: "age", operator: "<", value: 18 },
              { column: "active", operator: "=", value: 1 },
            ],
          },
        ],
      });
    });

    it("handles filters with table alias", () => {
      const result = analyze(sql`SELECT * FROM users u WHERE u.id = 1`);
      expect(result).toEqual({
        accessedTables: [
          {
            name: "users",
            columns: ["id"],
            filter: [{ column: "id", operator: "=", value: 1 }],
          },
        ],
      });
    });
  });

  //
  // Joins
  //
  describe("joins", () => {
    it("handles INNER JOIN with ON", () => {
      const result = analyze(
        sql`SELECT u.id, o.id FROM users u INNER JOIN orders o ON u.id = o.user_id`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "orders", columns: ["id", "user_id"], filter: [] },
        ],
      });
    });

    it("handles LEFT JOIN with ON", () => {
      const result = analyze(
        sql`SELECT u.id, o.id FROM users u LEFT JOIN orders o ON u.id = o.user_id`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "orders", columns: ["id", "user_id"], filter: [] },
        ],
      });
    });

    it("handles CROSS JOIN", () => {
      const result = analyze(
        sql`SELECT * FROM users CROSS JOIN roles`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: [], filter: [] },
          { name: "roles", columns: [], filter: [] },
        ],
      });
    });

    it("handles join with multiple ON conditions", () => {
      const result = analyze(
        sql`SELECT * FROM users u JOIN orders o ON u.id = o.user_id AND o.active = 1`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          {
            name: "orders",
            columns: ["user_id", "active"],
            filter: [{ column: "active", operator: "=", value: 1 }],
          },
        ],
      });
    });
  });

  //
  // Subqueries
  //
  describe("subqueries", () => {
    it("handles scalar subquery in SELECT", () => {
      const result = analyze(
        sql`SELECT (SELECT COUNT(*) FROM orders) AS order_count FROM users`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "orders", columns: [], filter: [] },
          { name: "users", columns: [], filter: [] },
        ],
      });
    });

    it("handles IN subquery in WHERE", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "orders", columns: ["user_id"], filter: [] },
        ],
      });
    });

    it("handles EXISTS subquery in WHERE", () => {
      const result = analyze(
        sql`SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders)`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: [], filter: [] },
          { name: "orders", columns: [], filter: [] },
        ],
      });
    });

    it("handles subquery in FROM", () => {
      const result = analyze(
        sql`SELECT * FROM (SELECT id FROM users) sub`
      );
      expect(result).toEqual({
        accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
      });
    });
  });

  //
  // Aggregation
  //
  describe("aggregation", () => {
    it("handles GROUP BY", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "orders", columns: ["user_id"], filter: [] },
        ],
      });
    });

    it("handles HAVING with literal", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1`
      );
      expect(result).toEqual({
        accessedTables: [
          {
            name: "orders",
            columns: ["user_id"],
            filter: [{ column: "user_id", operator: ">", value: 1 }],
          },
        ],
      });
    });

    it("handles HAVING with param", () => {
      const result = analyze(
        sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > ${2}`
      );
      expect(result).toEqual({
        accessedTables: [
          {
            name: "orders",
            columns: ["user_id"],
            filter: [{ column: "user_id", operator: ">", value: 2 }],
          },
        ],
      });
    });
  });

  //
  // Compound Queries
  //
  describe("compound queries", () => {
    it("handles UNION", () => {
      const result = analyze(
        sql`SELECT id FROM users UNION SELECT id FROM admins`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "admins", columns: ["id"], filter: [] },
        ],
      });
    });

    it("handles UNION ALL", () => {
      const result = analyze(
        sql`SELECT id FROM users UNION ALL SELECT id FROM admins`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "admins", columns: ["id"], filter: [] },
        ],
      });
    });

    it("handles INTERSECT", () => {
      const result = analyze(
        sql`SELECT id FROM users INTERSECT SELECT id FROM admins`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "admins", columns: ["id"], filter: [] },
        ],
      });
    });

    it("handles EXCEPT", () => {
      const result = analyze(
        sql`SELECT id FROM users EXCEPT SELECT id FROM banned_users`
      );
      expect(result).toEqual({
        accessedTables: [
          { name: "users", columns: ["id"], filter: [] },
          { name: "banned_users", columns: ["id"], filter: [] },
        ],
      });
    });
  });
});

//
// Integration Tests
//
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
      accessedTables: [
        {
          name: "users",
          columns: ["id", "active"],
          filter: [{ column: "active", operator: "=", value: 1 }],
        },
        {
          name: "orders",
          columns: ["id", "user_id"],
          filter: [{ column: "id", operator: ">", value: 2 }],
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
      accessedTables: [
        { name: "users", columns: ["active"], filter: [
          { column: "active", operator: "=", value: 1 }
        ] },
        { name: "admins", columns: ["id"], filter: [] },
        { name: "roles", columns: ["user_id", "id"], filter: [] },
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
      accessedTables: [
        { name: "users", columns: ["id"], filter: [] },
        { name: "orders", columns: ["user_id", "order_id"], filter: [] },
        {
          name: "shipments",
          columns: ["id", "status"],
          filter: [{ column: "status", operator: "=", value: "delivered" }],
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
      accessedTables: [
        {
          name: "users",
          columns: ["id", "active"],
          filter: [{ column: "active", operator: "=", value: 1 }],
        },
        { name: "orders", columns: ["id", "user_id"], filter: [] },
        {
          name: "payments",
          columns: ["id", "order_id", "status"],
          filter: [{ column: "status", operator: "=", value: "paid" }],
        },
      ],
    });
  });
});
