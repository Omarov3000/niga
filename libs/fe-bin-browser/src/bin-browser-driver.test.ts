import { expect, it } from 'vitest';
import { makeBrowserSQLite } from './bin-browser-driver';
import { runSharedBinDriverTests } from '@w/bin/src/run-shared-bin-driver-tests';
import { BinBrowserDriver } from './bin-browser-driver';

const {driverRef, clearRef} = runSharedBinDriverTests(() => new BinBrowserDriver(makeBrowserSQLite()), { skipTableCleanup: true })

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
