import { Table, BaseTable, type TableConstructorOptions } from '../schema/table'
import type { Column } from '../schema/column'
import type { DerivationContext } from '../schema/types'

export class DerivedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>> extends Table<Name, TCols> {
  private derivationFn?: (context: DerivationContext) => Promise<void>
  private sourceTables?: BaseTable<any, any>[]

  constructor(options: TableConstructorOptions<Name, TCols>) {
    super(options)
    // derivedFrom is undefined until derive() is called
    // This table is NOT considered derived until it has actual dependencies
  }

  // Clone is inherited from Table and already copies all properties including private ones

  // Called after db is created to define derivation logic
  derive(
    fn: (context: DerivationContext) => Promise<void>,
    sourceTables: BaseTable<any, any>[]
  ): this {
    if (sourceTables.length === 0) {
      throw new Error('DerivedTable must have at least one source table dependency')
    }

    this.derivationFn = fn
    this.sourceTables = sourceTables

    // Mark as derived by storing source table names
    this.__meta__.derivedFrom = sourceTables.map(t => t.__meta__.name)

    return this
  }

  // Internal method called by db to revalidate
  async _revalidate(context: DerivationContext): Promise<void> {
    if (!this.derivationFn) {
      throw new Error('Derivation function not set yet - skip revalidation')
    }

    // Execute derivation function with context
    // The function captures db from closure
    await this.derivationFn(context)
  }
}
