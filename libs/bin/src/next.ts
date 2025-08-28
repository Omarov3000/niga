// // --------------------
// // Simplified Analysis Types
// // --------------------

// // Flattened view of accessed tables
// type AccessedTable = {
//   name: string; // original table name (not alias)
//   columns: string[]; // all accessed columns (original names, not aliases)
//   filter: {
//     column: string;
//     operator: ComparisonOperator;
//     value: string | number | null;
//   }[];
// };

// type QueryAnalysis = {
//   accessedTables: AccessedTable[];
// };

// function analyze(sql: SelectSql): QueryAnalysis {}

// import { describe, it, expect } from "vitest";

// // Assuming we already have:
// //   - sql`...` helper
// //   - analyze(sql: SelectSql): QueryAnalysis

// describe("analyze - unit tests", () => {
//   //
//   // Columns & Tables
//   //
//   describe("columns & tables", () => {
//     it("extracts simple columns", () => {
//       const result = analyze(sql`SELECT id, name FROM users`);
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id", "name"], filter: [] },
//         ],
//       });
//     });

//     it("extracts star column", () => {
//       const result = analyze(sql`SELECT * FROM users`);
//       expect(result).toEqual({
//         accessedTables: [{ name: "users", columns: [], filter: [] }],
//       });
//     });

//     it("resolves column alias", () => {
//       const result = analyze(sql`SELECT id AS user_id FROM users`);
//       expect(result).toEqual({
//         accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
//       });
//     });

//     it("resolves table alias", () => {
//       const result = analyze(sql`SELECT u.id FROM users u`);
//       expect(result).toEqual({
//         accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
//       });
//     });
//   });

//   //
//   // Filters
//   //
//   describe("filters", () => {
//     it("handles simple comparison with literal", () => {
//       const result = analyze(sql`SELECT * FROM users WHERE age > 18`);
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "users",
//             columns: ["age"],
//             filter: [{ column: "age", operator: ">", value: 18 }],
//           },
//         ],
//       });
//     });

//     it("handles comparison with param", () => {
//       const result = analyze(sql`SELECT * FROM users WHERE name = ${"bob"}`);
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "users",
//             columns: ["name"],
//             filter: [{ column: "name", operator: "=", value: "bob" }],
//           },
//         ],
//       });
//     });

//     it("handles multiple filters with AND", () => {
//       const result = analyze(
//         sql`SELECT * FROM users WHERE age >= ${18} AND active = 1`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "users",
//             columns: ["age", "active"],
//             filter: [
//               { column: "age", operator: ">=", value: 18 },
//               { column: "active", operator: "=", value: 1 },
//             ],
//           },
//         ],
//       });
//     });

//     it("handles OR filters", () => {
//       const result = analyze(
//         sql`SELECT * FROM users WHERE age < 18 OR active = 1`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "users",
//             columns: ["age", "active"],
//             filter: [
//               { column: "age", operator: "<", value: 18 },
//               { column: "active", operator: "=", value: 1 },
//             ],
//           },
//         ],
//       });
//     });

//     it("handles filters with table alias", () => {
//       const result = analyze(sql`SELECT * FROM users u WHERE u.id = 1`);
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "users",
//             columns: ["id"],
//             filter: [{ column: "id", operator: "=", value: 1 }],
//           },
//         ],
//       });
//     });
//   });

//   //
//   // Joins
//   //
//   describe("joins", () => {
//     it("handles INNER JOIN with ON", () => {
//       const result = analyze(
//         sql`SELECT u.id, o.id FROM users u INNER JOIN orders o ON u.id = o.user_id`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "orders", columns: ["id", "user_id"], filter: [] },
//         ],
//       });
//     });

//     it("handles LEFT JOIN with ON", () => {
//       const result = analyze(
//         sql`SELECT u.id, o.id FROM users u LEFT JOIN orders o ON u.id = o.user_id`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "orders", columns: ["id", "user_id"], filter: [] },
//         ],
//       });
//     });

//     it("handles CROSS JOIN", () => {
//       const result = analyze(
//         sql`SELECT * FROM users CROSS JOIN roles`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: [], filter: [] },
//           { name: "roles", columns: [], filter: [] },
//         ],
//       });
//     });

//     it("handles join with multiple ON conditions", () => {
//       const result = analyze(
//         sql`SELECT * FROM users u JOIN orders o ON u.id = o.user_id AND o.active = 1`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           {
//             name: "orders",
//             columns: ["user_id", "active"],
//             filter: [{ column: "active", operator: "=", value: 1 }],
//           },
//         ],
//       });
//     });
//   });

//   //
//   // Subqueries
//   //
//   describe("subqueries", () => {
//     it("handles scalar subquery in SELECT", () => {
//       const result = analyze(
//         sql`SELECT (SELECT COUNT(*) FROM orders) AS order_count FROM users`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "orders", columns: [], filter: [] },
//           { name: "users", columns: [], filter: [] },
//         ],
//       });
//     });

//     it("handles IN subquery in WHERE", () => {
//       const result = analyze(
//         sql`SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "orders", columns: ["user_id"], filter: [] },
//         ],
//       });
//     });

//     it("handles EXISTS subquery in WHERE", () => {
//       const result = analyze(
//         sql`SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders)`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: [], filter: [] },
//           { name: "orders", columns: [], filter: [] },
//         ],
//       });
//     });

//     it("handles subquery in FROM", () => {
//       const result = analyze(
//         sql`SELECT * FROM (SELECT id FROM users) sub`
//       );
//       expect(result).toEqual({
//         accessedTables: [{ name: "users", columns: ["id"], filter: [] }],
//       });
//     });
//   });

//   //
//   // Aggregation
//   //
//   describe("aggregation", () => {
//     it("handles GROUP BY", () => {
//       const result = analyze(
//         sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "orders", columns: ["user_id"], filter: [] },
//         ],
//       });
//     });

//     it("handles HAVING with literal", () => {
//       const result = analyze(
//         sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > 1`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "orders",
//             columns: ["user_id"],
//             filter: [{ column: "user_id", operator: ">", value: 1 }],
//           },
//         ],
//       });
//     });

//     it("handles HAVING with param", () => {
//       const result = analyze(
//         sql`SELECT user_id, COUNT(*) FROM orders GROUP BY user_id HAVING COUNT(*) > ${2}`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           {
//             name: "orders",
//             columns: ["user_id"],
//             filter: [{ column: "user_id", operator: ">", value: 2 }],
//           },
//         ],
//       });
//     });
//   });

//   //
//   // Compound Queries
//   //
//   describe("compound queries", () => {
//     it("handles UNION", () => {
//       const result = analyze(
//         sql`SELECT id FROM users UNION SELECT id FROM admins`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "admins", columns: ["id"], filter: [] },
//         ],
//       });
//     });

//     it("handles UNION ALL", () => {
//       const result = analyze(
//         sql`SELECT id FROM users UNION ALL SELECT id FROM admins`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "admins", columns: ["id"], filter: [] },
//         ],
//       });
//     });

//     it("handles INTERSECT", () => {
//       const result = analyze(
//         sql`SELECT id FROM users INTERSECT SELECT id FROM admins`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "admins", columns: ["id"], filter: [] },
//         ],
//       });
//     });

//     it("handles EXCEPT", () => {
//       const result = analyze(
//         sql`SELECT id FROM users EXCEPT SELECT id FROM banned_users`
//       );
//       expect(result).toEqual({
//         accessedTables: [
//           { name: "users", columns: ["id"], filter: [] },
//           { name: "banned_users", columns: ["id"], filter: [] },
//         ],
//       });
//     });
//   });
// });

// //
// // Integration Tests
// //
// describe("analyze - integration tests", () => {
//   it("handles join + where + group by + having + order by + limit", () => {
//     const result = analyze(sql`
//       SELECT u.id, COUNT(o.id) AS order_count
//       FROM users u
//       LEFT JOIN orders o ON u.id = o.user_id
//       WHERE u.active = 1
//       GROUP BY u.id
//       HAVING COUNT(o.id) > 2
//       ORDER BY order_count DESC
//       LIMIT 10 OFFSET 5
//     `);

//     expect(result).toEqual({
//       accessedTables: [
//         {
//           name: "users",
//           columns: ["id", "active"],
//           filter: [{ column: "active", operator: "=", value: 1 }],
//         },
//         {
//           name: "orders",
//           columns: ["id", "user_id"],
//           filter: [{ column: "id", operator: ">", value: 2 }],
//         },
//       ],
//     });
//   });

//   it("handles CTE + subquery + compound select", () => {
//     const result = analyze(sql`
//       WITH active_users AS (
//         SELECT * FROM users WHERE active = 1
//       )
//       SELECT id FROM active_users
//       UNION ALL
//       SELECT id FROM admins WHERE EXISTS (
//         SELECT 1 FROM roles WHERE roles.user_id = admins.id
//       )
//       ORDER BY id DESC
//       LIMIT 3
//     `);

//     expect(result).toEqual({
//       accessedTables: [
//         { name: "users", columns: ["active"], filter: [
//           { column: "active", operator: "=", value: 1 }
//         ] },
//         { name: "admins", columns: ["id"], filter: [] },
//         { name: "roles", columns: ["user_id", "id"], filter: [] },
//       ],
//     });
//   });

//   it("handles nested subqueries", () => {
//     const result = analyze(sql`
//       SELECT * FROM users
//       WHERE id IN (
//         SELECT user_id FROM orders
//         WHERE order_id IN (
//           SELECT id FROM shipments WHERE status = 'delivered'
//         )
//       )
//     `);

//     expect(result).toEqual({
//       accessedTables: [
//         { name: "users", columns: ["id"], filter: [] },
//         { name: "orders", columns: ["user_id", "order_id"], filter: [] },
//         {
//           name: "shipments",
//           columns: ["id", "status"],
//           filter: [{ column: "status", operator: "=", value: "delivered" }],
//         },
//       ],
//     });
//   });

//   it("handles multiple joins and filters across tables", () => {
//     const result = analyze(sql`
//       SELECT u.id, o.id, p.id
//       FROM users u
//       JOIN orders o ON u.id = o.user_id
//       JOIN payments p ON o.id = p.order_id
//       WHERE u.active = 1 AND p.status = 'paid'
//     `);

//     expect(result).toEqual({
//       accessedTables: [
//         {
//           name: "users",
//           columns: ["id", "active"],
//           filter: [{ column: "active", operator: "=", value: 1 }],
//         },
//         { name: "orders", columns: ["id", "user_id"], filter: [] },
//         {
//           name: "payments",
//           columns: ["id", "order_id", "status"],
//           filter: [{ column: "status", operator: "=", value: "paid" }],
//         },
//       ],
//     });
//   });
// });

// // --------------------
// // Security Rules API
// // --------------------

// type SecurityRule = (analysis: QueryAnalysis) => boolean;

// declare function accessTheirOwnData(
//   tableName: string,
//   idColumn: string,
//   currentUserId: string
// ): SecurityRule;

// // This should be default rule for all tables
// declare function denyTable(tableName: string): SecurityRule;

// declare function checkRules(
//   sql: SelectSql,
//   rules: SecurityRule[]
// ): boolean;
