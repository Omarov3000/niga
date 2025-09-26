import {
  type BinAsyncDriver,
  BinDriverLogger,
  getDbName,
  getNewSqlDbAndTable,
  isMutatingQuery,
  type NewSql,
  newSqlToSql,
} from '@w/bin'
import type { s } from '@uhu/types'
import type { D1Database } from '@cloudflare/workers-types'

export class BinD1Driver implements BinAsyncDriver {
  constructor(private db: D1Database) {}

  batch = (d: NewSql[], l?: L) => {
    l = l ?? nullLogger

    return l.span(getDbName(d), (l) => {
      l.info.mutation('tx')

      return this.db.batch(
        d.flatMap((d) => {
          if (d.method === 'insert') {
            const paramsCount = d.values.reduce((acc, v) => acc + v.length, 0)
            if (paramsCount > 100) {
              const qs = splitIntoBatches(d)
              return qs.map((q) => this.db.prepare(q.sql).bind(...q.params))
            }
          }

          const { sql, params } = newSqlToSql(d)
          l.info.mutation(d.method, { sql, params })

          return this.db.prepare(sql).bind(...params)
        }),
      )
    })
  }

  run = (q: NewSql, l?: L) => {
    l = l ?? nullLogger

    return l.span(getNewSqlDbAndTable(q), async (l) => {
      const logger = isMutatingQuery(q) ? l.detail.mutation : l.detail.query
      if (q.method === 'insert') {
        const paramsCount = q.values.reduce((acc, v) => acc + v.length, 0)
        if (paramsCount > 100) {
          const qs = splitIntoBatches(q)
          return Promise.all(qs.map((q) => this._run(q.sql, q.params)))
        }
      }

      const { sql, params } = newSqlToSql(q)
      const logResult = logger(q.method, { sql, params })

      const r = await this._run(sql, params)

      return logResult(r)
    })
  }

  private _run = async (sql: s, params: a[]) => {
    BinDriverLogger.logRun(sql, params)

    const stmt = this.db.prepare(sql).bind(...params)
    const result = await stmt.all()
    const r = result.results

    BinDriverLogger.logRunOutput(r)

    return r
  }

  exec = async (sql: s) => {
    BinDriverLogger.logExec(sql)

    const stmt = this.db.prepare(sql)
    const result = await stmt.run()
    const r = result.results

    BinDriverLogger.logExecOutput(r)
    return r
  }
}

// I hope limits page is wrong and we can perform 1000 queries https://discord.com/channels/595317990191398933/799437470004412476/1196484341950337075
function splitIntoBatches(o: NewSql) {
  if (o.method !== 'insert') throw new Error('Not implemented')

  const batches: a[][][] = []
  let batch: a[][] = []
  let acc = 0
  for (const values of o.values) {
    if (acc + values.length > 100) {
      batches.push(batch)
      batch = []
      acc = 0
    }

    batch.push(values)
    acc += values.length
  }

  batches.push(batch)

  return batches
    .map(
      (batch): NewSql => ({
        method: 'insert',
        table: o.table,
        cols: o.cols,
        values: batch,
        onConflictDoNothing: o.onConflictDoNothing,
      }),
    )
    .map(newSqlToSql)
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type a = any
