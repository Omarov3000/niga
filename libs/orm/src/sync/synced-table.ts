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

  // Mutation methods - throw for now, will implement later
  async insertWithUndo(_data: any): Promise<any> {
    throw new Error('insertWithUndo not implemented yet')
  }

  async updateWithUndo(_options: any): Promise<void> {
    throw new Error('updateWithUndo not implemented yet')
  }

  async deleteWithUndo(_options: any): Promise<void> {
    throw new Error('deleteWithUndo not implemented yet')
  }
}
