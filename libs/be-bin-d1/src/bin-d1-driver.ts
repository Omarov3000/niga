import type { BinDriver, TxDriver } from '@w/bin/src/types'
import type { RawSql } from '@w/bin/src/utils/sql'
import type { D1Database, D1Result } from '@cloudflare/workers-types'

const MAX_PARAMETERS_PER_STATEMENT = 100
const MAX_STATEMENTS_PER_BATCH = 50

export class BinD1Driver implements BinDriver {
  constructor(private readonly db: D1Database) {}

  exec = async (sql: string) => {
    const statements = safeSplit(sql, ';')
    for (const statement of statements) {
      if (statement.trim().length === 0) continue
      const prepared = this.db.prepare(statement)
      await prepared.run()
    }
  }

  run = async (rawSql: RawSql) => {
    const [result] = await this.batch([rawSql])
    return result ?? []
  }

  batch = async (statements: RawSql[]) => {
    if (statements.length === 0) return []

    const preparedStatements: ReturnType<D1Database['prepare']>[] = []
    const metadata: StatementMetadata[] = []

    statements.forEach((statement, index) => {
      const parts = splitIntoBatches(statement)
      parts.forEach((part) => {
        preparedStatements.push(this.db.prepare(part.query).bind(...part.params))
        metadata.push({ index })
      })
    })

    const finalResults: any[] = statements.map(() => undefined)

    let processed = 0
    for (const chunk of chunkArray(preparedStatements, MAX_STATEMENTS_PER_BATCH)) {
      const chunkMetadata = metadata.slice(processed, processed + chunk.length)
      const chunkResults = await this.db.batch(chunk)

      if (chunkResults.length !== chunk.length) {
        throw new Error('D1 batch returned mismatched result count')
      }

      chunkResults.forEach((result, offset) => {
        const meta = chunkMetadata[offset]
        assertSuccessful(result)

        const rows = Array.isArray(result.results) ? result.results : []
        const existing = finalResults[meta.index]
        if (existing === undefined) {
          finalResults[meta.index] = rows
        } else if (rows.length > 0) {
          finalResults[meta.index] = [...existing, ...rows]
        }
      })

      processed += chunk.length
    }

    return finalResults.map((rows) => (rows ?? []))
  }

  beginTransaction = async (): Promise<TxDriver> => {
    const queued: RawSql[] = []

    return {
      run: async (rawSql) => {
        if (isSelect(rawSql.query)) {
          throw new Error('you cannot run SELECT inside a transaction')
        }
        queued.push(rawSql)
      },
      commit: async () => {
        if (queued.length === 0) return

        await this.batch([...queued])
        queued.length = 0
      },
      rollback: async () => {
        queued.length = 0
      },
    }
  }
}

function isSelect(query: string): boolean {
  return query.toUpperCase().startsWith('SELECT')
}

function isInsert(query: string): boolean {
  return query.toUpperCase().startsWith('INSERT')
}

function safeSplit(sql: string, delimiter: string): string[] {
  return sql
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function chunkArray<T>(input: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size))
  }
  return chunks
}

interface InsertParts {
  prefix: string
  suffix: string
  groupTemplate: string
  paramsPerRow: number
}

interface StatementMetadata {
  index: number
}

function assertSuccessful(result: D1Result) {
  const error = (result as any)?.error
  if (error) {
    throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
  }

  const success = (result as any)?.success
  if (success === false) {
    throw new Error('D1 batch statement failed')
  }
}

function parseInsertStatement(query: string): InsertParts | null {
  if (!isInsert(query)) return null

  const upper = query.toUpperCase()
  const valuesIndex = upper.indexOf('VALUES')
  if (valuesIndex === -1) return null

  const firstGroupStart = query.indexOf('(', valuesIndex)
  if (firstGroupStart === -1) return null

  let depth = 0
  let firstGroupEnd = -1
  for (let i = firstGroupStart; i < query.length; i++) {
    const char = query[i]
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) {
        firstGroupEnd = i
        break
      }
    }
  }

  if (firstGroupEnd === -1) return null

  const groupTemplate = query.slice(firstGroupStart, firstGroupEnd + 1)
  const paramsPerRow = (groupTemplate.match(/\?/g) ?? []).length
  if (paramsPerRow === 0) return null

  let suffixIndex = firstGroupEnd + 1

  while (suffixIndex < query.length) {
    while (suffixIndex < query.length && /\s/.test(query[suffixIndex])) suffixIndex += 1
    if (suffixIndex >= query.length) break

    if (query[suffixIndex] !== ',') break

    suffixIndex += 1
    while (suffixIndex < query.length && /\s/.test(query[suffixIndex])) suffixIndex += 1
    if (suffixIndex >= query.length) return null
    if (query[suffixIndex] !== '(') return null

    depth = 0
    let closed = false
    for (let i = suffixIndex; i < query.length; i++) {
      const char = query[i]
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          suffixIndex = i + 1
          closed = true
          break
        }
      }
    }
    if (!closed) return null
  }

  const prefix = query.slice(0, firstGroupStart)
  const suffix = query.slice(suffixIndex)

  return { prefix, suffix, groupTemplate, paramsPerRow }
}

export function splitIntoBatches(rawSql: RawSql): RawSql[] {
  const parts = parseInsertStatement(rawSql.query)
  if (!parts) return [rawSql]

  const { prefix, suffix, groupTemplate, paramsPerRow } = parts

  if (rawSql.params.length <= MAX_PARAMETERS_PER_STATEMENT) return [rawSql]
  if (rawSql.params.length % paramsPerRow !== 0) {
    throw new Error('parameter count does not align with insert column count')
  }

  const rowsPerBatch = Math.floor(MAX_PARAMETERS_PER_STATEMENT / paramsPerRow)
  if (rowsPerBatch === 0) {
    throw new Error('single row exceeds D1 parameter limit')
  }

  const totalRows = rawSql.params.length / paramsPerRow
  const batches: RawSql[] = []

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += rowsPerBatch) {
    const rowsInBatch = Math.min(rowsPerBatch, totalRows - rowIndex)
    const paramsStart = rowIndex * paramsPerRow
    const paramsEnd = paramsStart + rowsInBatch * paramsPerRow
    const batchParams = rawSql.params.slice(paramsStart, paramsEnd)
    const rowTemplates = Array.from({ length: rowsInBatch }, () => groupTemplate)
    const query = `${prefix}${rowTemplates.join(', ')}${suffix}`
    batches.push({ query, params: batchParams })
  }

  return batches
}
