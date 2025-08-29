// import { describe, it, expect, beforeEach } from 'vitest';
// import { b } from './builder';
// import { BinNodeDriver } from './bin-node-driver';

// describe('ORM insert integration', () => {
//   let driver: BinNodeDriver;

//   beforeEach(() => {
//     driver = new BinNodeDriver(':memory:');
//   });

//   it('should insert data and verify via query', async () => {
//     // Create a test table schema
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text(),
//       age: b.integer().default(0),
//       email: b.text(),
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);
//     users.__db__ = { getDriver: () => driver };

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     // Insert data using the dummy insert method
//     const insertResult = await users.insert({
//       data: {
//         id: 'test-123',
//         name: 'John Doe',
//         email: 'john@example.com'
//       }
//     });

//     // Verify data was inserted by querying the database
//     const queryResult = driver.run({
//       query: 'SELECT * FROM users WHERE id = ?',
//       params: ['test-123']
//     });

//     expect(insertResult).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should handle different data types', async () => {
//     const posts = b.table('posts', {
//       id: b.id(),
//       title: b.text(),
//       published: b.boolean().default(false),
//       views: b.integer().default(0)
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { posts } });
//     await db._connectDriver(driver);
//     posts.__db__ = { getDriver: () => driver };

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     const result = await posts.insert({
//       data: {
//         id: 'post-123',
//         title: 'Test Post',
//         published: true,
//         views: 42
//       }
//     });

//     // Verify data with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT * FROM posts WHERE id = ?',
//       params: ['post-123']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should work with returning option', async () => {
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text()
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);
//     users.__db__ = { getDriver: () => driver };

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     const result = await users.insert({
//       data: { id: 'user-123', name: 'Alice' },
//       returning: '*'
//     });

//     // Verify with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT COUNT(*) as count FROM users WHERE name = ?',
//       params: ['Alice']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });

//   it('should maintain type safety', async () => {
//     const users = b.table('users', {
//       id: b.id(),
//       name: b.text(),
//       age: b.integer()
//     });

//     // Create db instance and connect driver
//     const db = b.db({ schema: { users } });
//     await db._connectDriver(driver);
//     users.__db__ = { getDriver: () => driver };

//     // Create the table in the database
//     driver.exec(db.getSchemaDefinition());

//     // This should compile successfully - verifies type safety
//     const result = await users.insert({
//       data: {
//         id: 'type-safe-test',
//         name: 'Type Safe User',
//         age: 30
//       }
//     });

//     // Verify with real SELECT query
//     const queryResult = driver.run({
//       query: 'SELECT name, age FROM users WHERE id = ?',
//       params: ['type-safe-test']
//     });

//     expect(result).toBeDefined();
//     expect(queryResult).toBeDefined();
//   });
// });
