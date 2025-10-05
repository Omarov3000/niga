import { BaseTable, type TableConstructorOptions } from '../schema/table'
import type { Column } from '../schema/column'
import type { DbMutation } from './types'

/**
 * SyncedTable extends BaseTable and replaces mutation methods with sync-aware versions
 * Read methods (select, as, make) are inherited from BaseTable
 */
export class SyncedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>> extends BaseTable<Name, TCols> {
  private onMutation: (mutation: DbMutation) => Promise<void>

  constructor(
    options: TableConstructorOptions<Name, TCols>,
    onMutation: (mutation: DbMutation) => Promise<void>
  ) {
    super(options)
    this.onMutation = onMutation
  }

  async insertWithUndo(data: any): Promise<any> {
    // Build full object using make
    const fullData = this.make(data)

    // Perform the insert using driver directly
    const driver = this.__db__.getDriver()
    const colsMeta = this.__meta__.columns
    const columnNames: string[] = []
    const params: any[] = []

    for (const [key] of Object.entries(colsMeta)) {
      const col = (this as any)[key]
      if (!col || col.__meta__.insertType === 'virtual') continue

      const value = (fullData as any)[key]
      if (value === undefined) continue
      const encoded = col.__meta__.encode ? col.__meta__.encode(value) : value
      columnNames.push(col.__meta__.dbName)
      params.push(encoded)
    }

    const placeholders = params.map(() => '?').join(', ')
    const query = `INSERT INTO ${this.__meta__.dbName} (${columnNames.join(', ')}) VALUES (${placeholders})`

    await driver.run({ query, params })

    // Create mutation with undo
    const mutation: DbMutation = {
      table: this.__meta__.name,
      type: 'insert',
      data: [fullData],
      undo: {
        type: 'delete',
        ids: [(fullData as any).id],
      },
    }

    // Enqueue mutation for sync
    await this.onMutation(mutation)

    return fullData
  }

  async updateWithUndo(_options: any): Promise<void> {
    throw new Error('updateWithUndo not implemented yet')
  }

  async deleteWithUndo(_options: any): Promise<void> {
    throw new Error('deleteWithUndo not implemented yet')
  }
}
