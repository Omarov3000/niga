import { default as sqlite3Module } from '@sqlite.org/sqlite-wasm'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { OrmDriver, TxDriver } from '@w/orm'
import type { RawSql } from '@w/orm'
import { _inlineParams } from '@w/orm'

// Static initialization
const warn = console.warn // sqlite3Module complains about opfs on the main thread
console.warn = () => {}
// when run in node vitest: undici TypeError: fetch failed cause: Error: not implemented... yet...
const sqlite3 = await sqlite3Module() // up to 200ms
setTimeout(() => (console.warn = warn), 100) // without setTimeout 100, it doesn't work

export function makeBrowserSQLite(path = ':memory:'): Database {
  return new sqlite3.oo1.DB(path)
}

function safeSplit(sql: string, delimiter: string): string[] {
  return sql.split(delimiter).filter(s => s.trim().length > 0)
}

export class OrmBrowserDriver implements OrmDriver {
  logging: boolean = false;

  constructor(
    private db: Database,
  ) {
  }

  exec = async (sql: string) => {
    if (this.logging) console.info('OrmBrowserDriver.exec:', { sql });
    safeSplit(sql, ';').forEach((s) => {
      if (s.trim().length > 0) {
        this.db.exec(s)
      }
    })
  }

  run = async ({ query, params }: RawSql) => {
    if (this.logging) console.info('OrmBrowserDriver.run:', _inlineParams({ query, params }));
    let stmt: any
    try {
      stmt = this.db.prepare(query)
    } catch (e) {
      console.error(query, params)
      throw e
    }

    const results: any[] = []

    try {
      if (params.length) stmt.bind(params)

      if (query.trim().toUpperCase().startsWith('SELECT') || query.trim().toUpperCase().startsWith('WITH')) {
        while (stmt.step()) {
          if (stmt.columnCount > 0) results.push(stmt.get({}))
        }
      } else {
        stmt.step()
      }
    } finally {
      stmt.finalize()
    }

    return results
  }

  batch = async (statements: RawSql[]) => {
    if (this.logging) console.info('OrmBrowserDriver.batch:', statements.map(s => _inlineParams(s)).join('; '));
    if (statements.length === 0) return []

    const results: any[] = []

    this.db.transaction((db) => {
      for (const { query, params } of statements) {
        const trimmed = query.trim().toUpperCase()
        const prepared = db.prepare(query)
        if (trimmed.startsWith('SELECT')) {
          const stmtResults: any[] = []
          if (params.length) prepared.bind(params)
          while (prepared.step()) {
            if (prepared.columnCount > 0) stmtResults.push(prepared.get({}))
          }
          results.push(stmtResults)
          prepared.finalize()
        } else {
          if (params.length) prepared.bind(params)
          prepared.step()
          prepared.finalize()
          results.push([])
        }
      }
    })

    return results
  }

  beginTransaction = async (): Promise<TxDriver> => {
    if (this.logging) console.info('OrmBrowserDriver.beginTransaction');
    this.db.exec('BEGIN')
    const self = this
    return {
      run: async ({ query, params }) => {
        if (self.logging) console.info('OrmBrowserDriver.tx.run:', _inlineParams({ query, params }));
        const q = self.db.prepare(query)
        if (query.trim().toUpperCase().startsWith('SELECT')) {
          throw new Error('you cannot run SELECT inside a transaction')
        }
        if (params.length) q.bind(params)
        q.step()
        q.finalize()
      },
      commit: async () => {
        if (self.logging) console.info('OrmBrowserDriver.tx.commit');
        self.db.exec('COMMIT')
      },
      rollback: async () => {
        if (self.logging) console.info('OrmBrowserDriver.tx.rollback');
        self.db.exec('ROLLBACK')
      },
    }
  }
}
