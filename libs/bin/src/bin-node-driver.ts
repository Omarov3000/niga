import Database from 'better-sqlite3';
import { BinDriver } from './schema/types';
import type { TxDriver } from './schema/types';
import { RawSql, inlineParams } from './utils/sql';

function safeSplit(sql: string, delimiter: string): string[] {
  return sql.split(delimiter).filter(s => s.trim().length > 0);
}

export class BinNodeDriver implements BinDriver {
  db: ReturnType<typeof Database>;
  logging: boolean = false;

  constructor(public path = ':memory:') {
    this.db = new Database(path);
  }

  exec = async (sql: string) => {
    if (this.logging) console.info('BinNodeDriver.exec:', { sql });
    safeSplit(sql, ';').forEach((s) => this.db.exec(s));
  };

  run = async ({ query, params }: RawSql) => {
    if (this.logging) console.info('BinNodeDriver.run:', inlineParams({ query, params }));
    const q = this.db.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) return q.all(params);
    q.run(params);
    return [];
  };

  batch = async (statements: RawSql[]) => {
    if (this.logging) console.info('BinNodeDriver.batch:', statements.map(s => inlineParams(s)).join('; '));
    if (statements.length === 0) return [];

    const results: any[] = [];
    const tx = this.db.transaction((stmts: RawSql[]) => {
      for (const { query, params } of stmts) {
        const trimmed = query.trim().toUpperCase();
        const prepared = this.db.prepare(query);
        if (trimmed.startsWith('SELECT')) {
          results.push(prepared.all(params));
        } else {
          prepared.run(params);
          results.push([]);
        }
      }
    });

    tx(statements);
    return results;
  };

  beginTransaction = async (): Promise<TxDriver> => {
    if (this.logging) console.info('BinNodeDriver.beginTransaction');
    this.db.exec('BEGIN');
    const self = this;
    return {
      run: async ({ query, params }) => {
        if (self.logging) console.info('BinNodeDriver.tx.run:', inlineParams({ query, params }));
        const q = self.db.prepare(query);
        if (query.trim().toUpperCase().startsWith('SELECT')) {
          throw new Error('you cannot run SELECT inside a transaction');
        }
        q.run(params);
      },
      commit: async () => {
        if (self.logging) console.info('BinNodeDriver.tx.commit');
        self.db.exec('COMMIT');
      },
      rollback: async () => {
        if (self.logging) console.info('BinNodeDriver.tx.rollback');
        self.db.exec('ROLLBACK');
      },
    };
  };
}
