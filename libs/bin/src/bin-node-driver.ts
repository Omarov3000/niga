import Database from 'better-sqlite3';
import { BinDriver } from './types';
import { RawSql } from './utils/sql';

function safeSplit(sql: string, delimiter: string): string[] {
  return sql.split(delimiter).filter(s => s.trim().length > 0);
}

export class BinNodeDriver implements BinDriver {
  db: ReturnType<typeof Database>;

  constructor(public path = ':memory:') {
    this.db = new Database(path);
  }

  exec = async (sql: string) => {
    safeSplit(sql, ';').forEach((s) => this.db.exec(s));
  };

  run = async ({ query, params }: RawSql) => {
    const q = this.db.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) return q.all(params);
    q.run(params);
    return [];
  };
}
