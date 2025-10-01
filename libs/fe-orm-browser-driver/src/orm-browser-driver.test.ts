import { expect, it } from 'vitest';
import { makeBrowserSQLite } from './orm-browser-driver';
import { runSharedOrmDriverTests } from '@w/orm/run-shared-orm-driver-tests';
import { OrmBrowserDriver } from './orm-browser-driver';

const {driver, clearRef} = runSharedOrmDriverTests(() => new OrmBrowserDriver(makeBrowserSQLite()), { skipTableCleanup: true })

// it('works', () => {
//   const db = makeBrowserSQLite();
//   db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
//   db.exec('INSERT INTO users (id, name) VALUES (1, \'John\')');
//   const stmt = db.prepare('SELECT * FROM users');
//   const rows: { id: number, name: string }[] = [];
//   while (stmt.step()) {
//     rows.push(stmt.get({}) as { id: number, name: string });
//   }
//   expect(rows).toEqual([{ id: 1, name: 'John' }]);
// });
