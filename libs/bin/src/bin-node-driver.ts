import { DatabaseSync } from 'node:sqlite';
import { BinDriver } from './schema/types';
import type { TxDriver } from './schema/types';
import { RawSql, inlineParams } from './utils/sql';

function safeSplit(sql: string, delimiter: string): string[] {
  return sql.split(delimiter).filter(s => s.trim().length > 0);
}

export class BinNodeDriver implements BinDriver {
  db: DatabaseSync;
  logging: boolean = false;

  constructor(public path = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  exec = async (sql: string) => {
    if (this.logging) console.info('BinNodeDriver.exec:', { sql });
    safeSplit(sql, ';').forEach((s) => this.db.exec(s));
  };

  run = async ({ query, params }: RawSql) => {
    if (this.logging) console.info('BinNodeDriver.run:', inlineParams({ query, params }));
    const stmt = this.db.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) {
      const result = stmt.all(...params);
      return result as any[];
    }
    stmt.run(...params);
    return [];
  };

  batch = async (statements: RawSql[]) => {
    if (this.logging) console.info('BinNodeDriver.batch:', statements.map(s => inlineParams(s)).join('; '));
    if (statements.length === 0) return [];

    const results: any[] = [];

    this.db.exec('BEGIN');
    try {
      for (const { query, params } of statements) {
        const trimmed = query.trim().toUpperCase();
        const stmt = this.db.prepare(query);
        if (trimmed.startsWith('SELECT')) {
          results.push(stmt.all(...params));
        } else {
          stmt.run(...params);
          results.push([]);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return results;
  };

  beginTransaction = async (): Promise<TxDriver> => {
    if (this.logging) console.info('BinNodeDriver.beginTransaction');
    this.db.exec('BEGIN');
    const self = this;
    return {
      run: async ({ query, params }) => {
        if (self.logging) console.info('BinNodeDriver.tx.run:', inlineParams({ query, params }));
        const stmt = self.db.prepare(query);
        if (query.trim().toUpperCase().startsWith('SELECT')) {
          throw new Error('you cannot run SELECT inside a transaction');
        }
        stmt.run(...params);
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
