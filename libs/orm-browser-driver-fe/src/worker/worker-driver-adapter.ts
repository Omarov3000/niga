import type { OrmDriver, TxDriver, RawSql } from '@w/orm'

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

export class WorkerDriverAdapter implements OrmDriver {
  logging: boolean = false
  private messageId = 0
  private pendingMessages = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>()

  constructor(private worker: Worker) {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, success, data, error } = event.data
      const pending = this.pendingMessages.get(id)
      if (!pending) return

      this.pendingMessages.delete(id)
      if (success) {
        pending.resolve(data)
      } else {
        pending.reject(new Error(error || 'Worker execution failed'))
      }
    }

    this.worker.onerror = (event) => {
      console.error('[WorkerDriverAdapter] Worker error:', event)
      this.pendingMessages.forEach(({ reject }) => {
        reject(new Error(`Worker error: ${event.message || 'Unknown error'}`))
      })
      this.pendingMessages.clear()
    }
  }

  sendMessage<T = any>(type: WorkerMessage['type'], payload?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `msg_${this.messageId++}`
      this.pendingMessages.set(id, { resolve, reject })

      const message: WorkerMessage = { id, type, payload }
      this.worker.postMessage(message)
    })
  }

  exec = async (sql: string): Promise<any> => {
    if (this.logging) console.info('WorkerDriverAdapter.exec:', { sql })
    return this.sendMessage('exec', { sql })
  }

  run = async (sql: RawSql): Promise<any> => {
    if (this.logging) console.info('WorkerDriverAdapter.run:', sql)
    return this.sendMessage('run', { sql })
  }

  batch = async (statements: RawSql[]): Promise<any[]> => {
    if (this.logging) console.info('WorkerDriverAdapter.batch:', statements)
    return this.sendMessage('batch', { statements })
  }

  beginTransaction = async (): Promise<TxDriver> => {
    if (this.logging) console.info('WorkerDriverAdapter.beginTransaction')
    const txId = await this.sendMessage<string>('beginTransaction')

    return {
      run: async (sql: RawSql) => {
        if (this.logging) console.info('WorkerDriverAdapter.tx.run:', sql)
        await this.sendMessage('tx.run', { txId, sql })
      },
      commit: async () => {
        if (this.logging) console.info('WorkerDriverAdapter.tx.commit')
        await this.sendMessage('tx.commit', { txId })
      },
      rollback: async () => {
        if (this.logging) console.info('WorkerDriverAdapter.tx.rollback')
        await this.sendMessage('tx.rollback', { txId })
      },
    }
  }

  terminate(): void {
    this.worker.terminate()
    this.pendingMessages.clear()
  }
}
