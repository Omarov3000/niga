// @ts-ignore - Package has type issues with exports
import { connect } from '@tursodatabase/database';
import { BinDriver } from './types';
import type { TxDriver } from './types';
import { RawSql, inlineParams } from './utils/sql';

function safeSplit(sql: string, delimiter: string): string[] {
  return sql.split(delimiter).filter(s => s.trim().length > 0);
}

export class BinTursoDriver implements BinDriver {
  dbPromise: Promise<any>;
  private _db: any | undefined;
  logging: boolean = false;

  constructor(public url = ':memory:') {
    this.dbPromise = (connect as any)(url);
  }

  private async getDb() {
    if (!this._db) {
      this._db = await this.dbPromise;
    }
    return this._db;
  }

  exec = async (sql: string) => {
    if (this.logging) console.info('BinTursoDriver.exec:', { sql });
    const db = await this.getDb();
    safeSplit(sql, ';').forEach((s) => {
      if (s.trim()) {
        (db as any).exec(s.trim());
      }
    });
  };

  run = async ({ query, params }: RawSql) => {
    if (this.logging) console.info('BinTursoDriver.run:', inlineParams({ query, params }));
    const db = await this.getDb();
    const stmt = (db as any).prepare(query);
    const upper = query.trim().toUpperCase();

    if (upper.startsWith('SELECT')) {
      const result = await (stmt as any).all(...(params || []));

      // Fix column name case mismatch - Turso returns lowercase but framework expects original case
      if (result.length > 0) {
        const normalizedResult = result.map((row: any) => {
          const normalizedRow: any = {};
          Object.entries(row).forEach(([key, value]) => {
            // Map common column name variations
            let normalizedKey = key;
            if (key === 'createdat') normalizedKey = 'createdAt';
            else if (key === 'updatedat') normalizedKey = 'updatedAt';
            else if (key === 'isactive') normalizedKey = 'isActive';
            normalizedRow[normalizedKey] = value;
          });
          return normalizedRow;
        });
        return normalizedResult;
      }

      return result;
    } else {
      await (stmt as any).run(...(params || []));
      return [];
    }
  };

  batch = async (statements: RawSql[]) => {
    if (this.logging) console.info('BinTursoDriver.batch:', statements.map(s => inlineParams(s)).join('; '));
    const results: any[] = [];
    for (const statement of statements) {
      results.push(await this.run(statement));
    }
    return results;
  };

  beginTransaction = async (): Promise<TxDriver> => {
    if (this.logging) console.info('BinTursoDriver.beginTransaction');
    throw new Error('Transactions are not implemented for this driver');
  };
}
