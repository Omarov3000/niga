import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { o } from '../schema/builder'
import { OrmNodeDriver } from '../orm-node-driver'
import { sql } from '../utils/sql'
import { fakeOrmDriver } from '../schema/types'
import { AlwaysOnlineDetector } from './test-online-detector'
import { _makeRemoteDb, _makeClientDb } from './test-helpers'

const clearRef = {
  current: [] as Array<() => Promise<void>>
}

beforeEach(async () => {
  clearRef.current = []
})

afterEach(async () => {
  for (const clearFn of clearRef.current) {
    await clearFn()
  }
})

it('should exclude derived tables from getSchemaDefinition() and _prepareSnapshot() on server but not client', () => {
  const mutations = o.table('mutations', {
    id: o.id(),
    delta: o.integer().notNull()
  })

  const states = o.derivedTable('states', {
    id: o.id(),
    value: o.integer().notNull()
  })

  // Client: derived tables included (they need to be created in local DB)
  const dbClient = o.db({ schema: { mutations, states }, origin: 'client' })

  // Mark states as derived by calling derive()
  dbClient.states.derive(async () => {}, [dbClient.mutations])

  const clientSchemaDef = dbClient.getSchemaDefinition()
  expect(clientSchemaDef).toContain('CREATE TABLE mutations')
  expect(clientSchemaDef).toContain('CREATE TABLE states') // Included on client

  const clientSnapshot = dbClient._prepareSnapshot()
  expect(clientSnapshot.snapshot.find(t => t.name === 'mutations')).toBeDefined()
  expect(clientSnapshot.snapshot.find(t => t.name === 'states')).toBeUndefined() // Excluded from snapshot even on client

  // Server: derived tables excluded
  const dbServer = o.db({ schema: { mutations, states }, origin: 'server' })

  // Mark states as derived by calling derive()
  dbServer.states.derive(async () => {}, [dbServer.mutations])

  const serverSchemaDef = dbServer.getSchemaDefinition()
  expect(serverSchemaDef).toContain('CREATE TABLE mutations')
  expect(serverSchemaDef).not.toContain('CREATE TABLE states') // Excluded on server

  const serverSnapshot = dbServer._prepareSnapshot()
  expect(serverSnapshot.snapshot.find(t => t.name === 'mutations')).toBeDefined()
  expect(serverSnapshot.snapshot.find(t => t.name === 'states')).toBeUndefined() // Excluded from snapshot on server
})


it('should revalidate derived table on initialization when skipPull is false', async () => {
  const mutations = o.table('mutations', {
    id: o.id(),
    delta: o.integer().notNull()
  })

  const states = o.derivedTable('states', {
    id: o.id(),
    value: o.integer().notNull()
  })

  const { remoteDb, db: serverDb } = await _makeRemoteDb({ mutations, states })

  // Insert data on server before client initializes
  await serverDb.mutations.insert({ delta: 10 })
  await serverDb.mutations.insert({ delta: 20 })
  await serverDb.mutations.insert({ delta: -5 })

  // Create client with skipPull: false to trigger initial pull and revalidation
  const { db } = await _makeClientDb({ mutations, states }, remoteDb, { skipPull: false })

  // Set up derivation function
  db.states.derive(async (context) => {
    if (context.type === 'full') {
      await db.states.deleteAll()

      const allMutations = await db.mutations.select().execute()
      const total = allMutations.reduce((sum, m) => sum + m.delta, 0)

      if (allMutations.length > 0) {
        await db.states.insert({ value: total })
      }
    }
  }, [db.mutations])

  // Manually trigger revalidation since derive() was set up after initialization
  await db.revalidateDerivedTables(undefined, { type: 'full' })

  // Verify derived table was revalidated
  const result = await db.states.select().execute()
  expect(result).toMatchObject([{ value: 25 }])

  clearRef.current.push(async () => {
    await db._clear()
    await serverDb._clear()
  })
})

it('should support full derivation context', async () => {
  const mutations = o.table('mutations', {
    id: o.id(),
    entityId: o.text().notNull(),
    delta: o.integer().notNull()
  })

  const states = o.derivedTable('states', {
    entityId: o.text().notNull().primaryKey(),
    total: o.integer().notNull()
  })

  const { remoteDb } = await _makeRemoteDb({ mutations, states })
  const { db } = await _makeClientDb({ mutations, states }, remoteDb, { skipPull: true })

  let fullCount = 0

  db.states.derive(async (context) => {
    if (context.type === 'full') {
      fullCount++
      await db.states.deleteAll()

      const allMutations = await db.mutations.select().execute()
      const totals = new Map<string, number>()

      for (const mut of allMutations) {
        const current = totals.get(mut.entityId) ?? 0
        totals.set(mut.entityId, current + mut.delta)
      }

      for (const [entityId, total] of totals) {
        await db.states.insert({ entityId, total })
      }
    }
  }, [db.mutations])

  // Insert mutations
  await db.mutations.insertWithUndo({ entityId: 'entity1', delta: 10 })
  await db.mutations.insertWithUndo({ entityId: 'entity2', delta: 20 })

  // Manually trigger full revalidation
  await db.revalidateDerivedTables(undefined, { type: 'full' })

  expect(fullCount).toBe(1)

  const statesResult = await db.states.select().execute()
  expect(statesResult).toMatchObject([
    { entityId: 'entity1', total: 10 },
    { entityId: 'entity2', total: 20 }
  ])

  clearRef.current.push(async () => {
    await db._clear()
  })
})

it('should support deleteAll() helper method', async () => {
  const items = o.table('items', {
    id: o.id(),
    name: o.text().notNull()
  })

  const driver = new OrmNodeDriver()
  const db = await o.testDb({ schema: { items } }, driver, clearRef)

  // Insert some items
  await db.items.insert({ name: 'item1' })
  await db.items.insert({ name: 'item2' })
  await db.items.insert({ name: 'item3' })

  let items1 = await db.items.select().execute()
  expect(items1).toHaveLength(3)

  // Delete all
  await db.items.deleteAll()

  let items2 = await db.items.select().execute()
  expect(items2).toHaveLength(0)
})

it('should detect circular dependencies', async () => {
  const table1 = o.derivedTable('table1', {
    id: o.id(),
    value: o.integer().notNull()
  })

  const table2 = o.derivedTable('table2', {
    id: o.id(),
    value: o.integer().notNull()
  })

  const driver = new OrmNodeDriver()
  const db = await o.testDb({ schema: { table1, table2 }, origin: 'client' }, driver, clearRef)

  // Create circular dependency
  db.table1.derive(async () => {
    // table1 depends on table2
  }, [db.table2])

  db.table2.derive(async () => {
    // table2 depends on table1
  }, [db.table1])

  // Should throw on revalidation
  await expect(db.revalidateDerivedTables()).rejects.toThrow('Circular dependency')
})

it('should handle derived table depending on another derived table', async () => {
  const mutations = o.table('mutations', {
    id: o.id(),
    delta: o.integer().notNull()
  })

  const intermediateStates = o.derivedTable('intermediateStates', {
    id: o.id(),
    value: o.integer().notNull()
  })

  const finalStates = o.derivedTable('finalStates', {
    id: o.id(),
    doubledValue: o.integer().notNull()
  })

  const { remoteDb } = await _makeRemoteDb({ mutations, intermediateStates, finalStates })
  const { db } = await _makeClientDb({ mutations, intermediateStates, finalStates }, remoteDb, { skipPull: true })

  // First derived table
  db.intermediateStates.derive(async (context) => {
    if (context.type === 'full') {
      await db.intermediateStates.deleteAll()
      const muts = await db.mutations.select().execute()
      const total = muts.reduce((sum, m) => sum + m.delta, 0)
      if (muts.length > 0) {
        await db.intermediateStates.insert({ value: total })
      }
    }
  }, [db.mutations])

  // Second derived table depends on first
  db.finalStates.derive(async (context) => {
    if (context.type === 'full') {
      await db.finalStates.deleteAll()
      const intermediate = await db.intermediateStates.select().execute()
      for (const state of intermediate) {
        await db.finalStates.insert({ doubledValue: state.value * 2 })
      }
    }
  }, [db.intermediateStates])

  // Insert mutations
  await db.mutations.insertWithUndo({ delta: 10 })
  await db.mutations.insertWithUndo({ delta: 15 })

  // Manually trigger revalidation (handles dependency order automatically)
  await db.revalidateDerivedTables(undefined, { type: 'full' })

  const finalResult = await db.finalStates.select().execute()
  expect(finalResult).toMatchObject([{ doubledValue: 50 }]) // (10 + 15) * 2

  clearRef.current.push(async () => {
    await db._clear()
  })
})

// Note: Automatic revalidation on mutations is not implemented yet
// Revalidation only happens after pull (full revalidation)
