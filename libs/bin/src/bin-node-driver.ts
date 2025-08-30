import Database from 'better-sqlite3';
import { connect } from '@tursodatabase/database';
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

  exec = (sql: string) => {
    safeSplit(sql, ';').forEach((s) => this.db.exec(s));
  };

  run = ({ query, params }: RawSql) => {
    const q = this.db.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) return q.all(params);
    q.run(params);
    return [];
  };
}

export class BinTursoDriver implements BinDriver {
  dbPromise: ReturnType<typeof connect>;
  private _db: any | undefined;

  constructor(public url = ':memory:') {
    this.dbPromise = connect(url);
  }

  private async getDb() {
    if (!this._db) this._db = await this.dbPromise;
    return this._db;
  }

  exec = async (sql: string) => {
    const db = await this.getDb();
    safeSplit(sql, ';').forEach((s) => db.exec(s));
  };

  run = async ({ query, params }: RawSql) => {
    const db = await this.getDb();
    const stmt = db.prepare(query);
    const upper = query.trim().toUpperCase();
    if (upper.startsWith('SELECT')) return stmt.all(...(params ?? []));
    await stmt.run(...(params ?? []));
    return [];
  };
}
