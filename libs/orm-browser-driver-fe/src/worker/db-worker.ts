// Lazy import to avoid top-level await blocking worker initialization
import type { Database } from '@sqlite.org/sqlite-wasm'
import type { RawSql, TxDriver, TableSnapshot } from '@w/orm'
import type { OrmBrowserDriver } from '../orm-browser-driver'
import { migrateDB, sortedJSONStringify } from '../migrate-db'

interface WorkerMessage {
  id: string
  type: 'init' | 'exec' | 'run' | 'batch' | 'beginTransaction' | 'tx.run' | 'tx.commit' | 'tx.rollback'
  payload?: any
}

interface WorkerResponse {
  id: string
  success: boolean
  data?: any
  error?: string
}

let driver: OrmBrowserDriver | null = null
let db: Database | null = null
const transactions = new Map<string, TxDriver>()
let txIdCounter = 0

function sendResponse(id: string, success: boolean, data?: any, error?: string) {
  const response: WorkerResponse = { id, success, data, error }
  self.postMessage(response)
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = event.data

  try {
    switch (type) {
      case 'init': {
        const { dbPath, snapshot, migrationSql, snapshotHash, logging } = payload

        // Lazy load SQLite only when needed
        const { makeBrowserSQLite, OrmBrowserDriver } = await import('../orm-browser-driver')

        const dbInstance = makeBrowserSQLite(dbPath || ':memory:')

        if (snapshot && migrationSql && snapshotHash) {
          migrateDB(dbInstance, snapshot, migrationSql, snapshotHash, logging)
        }

        const driverInstance = new OrmBrowserDriver(dbInstance)
        driverInstance.logging = logging || false
        driver = driverInstance as any
        sendResponse(id, true, { initialized: true })
        break
      }

      case 'exec': {
        if (!driver) throw new Error('Driver not initialized')
        const result = await driver.exec(payload.sql)
        sendResponse(id, true, result)
        break
      }

      case 'run': {
        if (!driver) throw new Error('Driver not initialized')
        const result = await driver.run(payload.sql as RawSql)
        sendResponse(id, true, result)
        break
      }

      case 'batch': {
        if (!driver) throw new Error('Driver not initialized')
        const result = await driver.batch(payload.statements as RawSql[])
        sendResponse(id, true, result)
        break
      }

      case 'beginTransaction': {
        if (!driver) throw new Error('Driver not initialized')
        const tx = await driver.beginTransaction()
        const txId = `tx_${txIdCounter++}`
        transactions.set(txId, tx)
        sendResponse(id, true, txId)
        break
      }

      case 'tx.run': {
        const { txId, sql } = payload
        const tx = transactions.get(txId)
        if (!tx) throw new Error(`Transaction ${txId} not found`)
        await tx.run(sql as RawSql)
        sendResponse(id, true)
        break
      }

      case 'tx.commit': {
        const { txId } = payload
        const tx = transactions.get(txId)
        if (!tx) throw new Error(`Transaction ${txId} not found`)
        await tx.commit()
        transactions.delete(txId)
        sendResponse(id, true)
        break
      }

      case 'tx.rollback': {
        const { txId } = payload
        const tx = transactions.get(txId)
        if (!tx) throw new Error(`Transaction ${txId} not found`)
        await tx.rollback()
        transactions.delete(txId)
        sendResponse(id, true)
        break
      }

      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Worker] Error:', errorMessage)
    sendResponse(id, false, undefined, errorMessage)
  }
}
