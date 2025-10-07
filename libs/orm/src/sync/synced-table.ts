import { BaseTable, type TableConstructorOptions, type ColumnsOnly, type InsertableForCols, type SelectableForCols } from '../schema/table'
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

  async insertWithUndo<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf> = ColumnsOnly<TSelf>>(
    this: TSelf,
    data: InsertableForCols<TSelfCols>
  ): Promise<SelectableForCols<TSelfCols>> {
    // Build full object using make
    const fullData = this.make(data) as SelectableForCols<TSelfCols>

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

  async updateWithUndo<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf> = ColumnsOnly<TSelf>>(
    this: TSelf,
    options: {
      data: Partial<InsertableForCols<TSelfCols>>;
      where: { id: string };
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver()

    // Encode ID for query
    const idCol = (this as any).id
    const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(options.where.id) : options.where.id

    // IMPORTANT: Read original data before updating for undo
    const originalRows = await driver.run({
      query: `SELECT * FROM ${this.__meta__.dbName} WHERE id = ?`,
      params: [encodedId],
    })

    if (originalRows.length === 0) {
      throw new Error(`No row found with id ${options.where.id}`)
    }

    // Convert snake_case to camelCase for original data
    const originalData: Record<string, any> = {}
    for (const [key, value] of Object.entries(originalRows[0])) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      // Decode if column has decode function
      const col = (this as any)[camelKey]
      originalData[camelKey] = col?.__meta__.decode ? col.__meta__.decode(value) : value
    }

    // Perform the update
    const setClause: string[] = []
    const params: any[] = []

    for (const [key, value] of Object.entries(options.data)) {
      if (value === undefined) continue
      const col = (this as any)[key]
      if (!col || col.__meta__.insertType === 'virtual') continue

      const encoded = col.__meta__.encode ? col.__meta__.encode(value) : value
      setClause.push(`${col.__meta__.dbName} = ?`)
      params.push(encoded)
    }

    if (setClause.length === 0) {
      throw new Error('No columns to update')
    }

    params.push(encodedId)
    const query = `UPDATE ${this.__meta__.dbName} SET ${setClause.join(', ')} WHERE id = ?`
    await driver.run({ query, params })

    // Create mutation with undo
    const mutation: DbMutation = {
      table: this.__meta__.name,
      type: 'update',
      data: { ...options.data, id: options.where.id },
      undo: {
        type: 'update',
        data: [originalData],
      },
    }

    // Enqueue mutation for sync
    await this.onMutation(mutation)
  }

  async deleteWithUndo<TSelf extends this, TSelfCols extends ColumnsOnly<TSelf> = ColumnsOnly<TSelf>>(
    this: TSelf,
    options: {
      where: { id: any };
    }
  ): Promise<void> {
    const driver = this.__db__.getDriver()

    // Encode ID for query
    const idCol = (this as any).id
    const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(options.where.id) : options.where.id

    // IMPORTANT: Read data before deleting for undo
    const rows = await driver.run({
      query: `SELECT * FROM ${this.__meta__.dbName} WHERE id = ?`,
      params: [encodedId],
    })

    if (rows.length === 0) {
      throw new Error(`No row found with id ${options.where.id}`)
    }

    // Convert snake_case to camelCase
    const deletedData: Record<string, any> = {}
    for (const [key, value] of Object.entries(rows[0])) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      // Decode if column has decode function
      const col = (this as any)[camelKey]
      deletedData[camelKey] = col?.__meta__.decode ? col.__meta__.decode(value) : value
    }

    // Perform the delete
    const query = `DELETE FROM ${this.__meta__.dbName} WHERE id = ?`
    await driver.run({ query, params: [encodedId] })

    // Create mutation with undo
    const mutation: DbMutation = {
      table: this.__meta__.name,
      type: 'delete',
      ids: [options.where.id],
      undo: {
        type: 'insert',
        data: [deletedData],
      },
    }

    // Enqueue mutation for sync
    await this.onMutation(mutation)
  }
}
