# Derived Tables Design

## Overview

Derived tables are **client-only** tables whose data is computed from other tables. They provide a way to maintain materialized views that are automatically revalidated when source data changes or sync completes.

**Example**: A `states` table derived from a `mutations` table:
```typescript
const mutations = o.table('mutations', {
  id: o.id(),
  delta: o.integer()
})

const states = o.derivedTable('states', {
  id: o.id(),
  value: o.integer()
})

const db = await o.syncedDb({ schema: { mutations, states }, ... })

// Define derivation logic after db is created
// The function captures `db` from closure, receives invalidation context
db.states.derive(async (context) => {
  if (context.type === 'full') {
    // Full recomputation (e.g., after initial pull)
    await db.states.deleteAll()

    const allMutations = await db.mutations.select().execute()
    let total = 0
    for (const mut of allMutations) {
      total += mut.delta
    }

    await db.states.insert({ value: total })
  } else {
    // Incremental update (e.g., after specific mutations)
    // context = { type: 'incremental', mutationType: 'insert' | 'update' | 'delete', ids: string[] }

    if (context.mutationType === 'delete') {
      // Recalculate total without deleted mutations
      await db.states.deleteAll()
      const allMutations = await db.mutations.select().execute()
      const total = allMutations.reduce((sum, m) => sum + m.delta, 0)
      await db.states.insert({ value: total })
    } else {
      // For insert/update, recalculate affected entities
      const affectedMutations = await db.mutations
        .select({ where: sql`id IN (${context.ids.join(',')})` })
        .execute()

      // Update logic here...
    }
  }
}, [db.mutations]) // Explicit dependency declaration
```

---

## 1. API Design

### Table Definition
```typescript
// Source table (normal table)
const mutations = o.table('mutations', {
  id: o.id(),
  delta: o.integer()
})

// Derived table (marked as derived)
const states = o.derivedTable('states', {
  id: o.id(),
  value: o.integer()
})
```

### Derivation Function
```typescript
const db = await o.syncedDb({ schema: { mutations, states }, ... })

// Define derivation - called AFTER db is created
// Function captures `db` from closure, receives invalidation context
db.states.derive(async (context) => {
  if (context.type === 'full') {
    // Full recomputation after initial pull
    await db.states.deleteAll()
    // Compute from scratch...
  } else {
    // Incremental update: context.mutationType, context.ids
    // Only re-evaluate affected records
  }
}, [db.mutations]) // Explicit dependency array
```

### Key Properties
- `o.derivedTable()` creates a `DerivedTable` which extends `Table`
- The derive method is **only available on DerivedTable instances**
- Derivation function **captures `db` from closure** (no db passed as parameter)
- Derivation function receives **invalidation context** to support incremental updates
- Dependencies declared explicitly as second argument (array of source tables)
- Derivation function is async and can perform any queries/mutations

---

## 2. Origin Filtering (CRITICAL)

Derived tables are **CLIENT-ONLY**. They must be completely invisible to server-side code.

### Schema Filtering

When `origin !== 'client'`, derived tables must be filtered from:

#### `getSchema()`
Returns the schema object used for security checks, query analysis, etc.
```typescript
getSchema(): Record<string, Table<any, any>> {
  const schema = this.options.schema

  // If not client, filter out derived tables
  if (this.origin !== 'client') {
    return Object.fromEntries(
      Object.entries(schema).filter(([_, table]) => !table.__meta__.isDerived)
    )
  }

  return schema
}
```

#### `getSchemaDefinition()`
Returns SQL CREATE TABLE statements for migrations.
```typescript
getSchemaDefinition(mode: 'full' | 'minimal' = 'full'): string {
  const parts: string[] = []

  Object.values(this.options.schema).forEach(({ __meta__ }) => {
    // Skip derived tables - they don't have SQL schema on server
    if (__meta__.isDerived) return

    const tableSnapshot = tableMetaToSnapshot(__meta__)
    parts.push(serializeCreateTable(tableSnapshot, mode))
    // ...
  })

  return parts.join('\n\n')
}
```

#### `_prepareSnapshot()`
Used for schema migrations - derived tables should not appear in snapshots.
```typescript
function buildSnapshotFromSchema(schema: Record<string, Table<any, any>>): TableSnapshot[] {
  return Object.values(schema)
    .filter(table => !table.__meta__.isDerived) // Exclude derived tables
    .map((table) => tableMetaToSnapshot(table.__meta__))
    .sort((a, b) => a.dbName.localeCompare(b.dbName))
}
```

### Why This Matters

1. **Server databases don't have derived tables**: The server DB schema should not contain derived table definitions
2. **Sync protocol**: When syncing schema or data, derived tables are not transmitted
3. **Security**: Query analysis on server side shouldn't see derived tables
4. **Migrations**: Schema migrations don't attempt to create/alter derived tables on server

---

## 3. Sync Integration

Derived tables must work correctly during all sync states without blocking queries.

### Sync States

```typescript
export type SyncState = 'pulling' | 'gettingLatest' | 'synced'
```

1. **'pulling'**: Initial data pull from server (first sync or resuming interrupted sync)
2. **'gettingLatest'**: Fetching and applying latest mutations from server
3. **'synced'**: Fully synchronized, no pending operations

### Query Behavior During Sync

**Key Principle**: Derived tables are **client-only mutations/state** and should NEVER be proxied or blocked during sync.

```typescript
// In SyncedTable or query execution
async execute() {
  // For normal (non-derived) tables during sync:
  // - May need to proxy to server
  // - May need to wait for sync to complete

  // For derived tables:
  // - ALWAYS query local database
  // - NEVER proxy to server (derived tables don't exist there)
  // - Return potentially stale data during sync
}
```

### Revalidation Triggers

Derived tables need to be recomputed when their source data changes:

#### 1. After Initial Pull Completes
```typescript
// In SyncedDb.initialize()
if (!pullCompleted) {
  this.syncState = 'pulling'
  await this.pullAll()
}
this.syncState = 'gettingLatest'

// After sync completes
this.syncState = 'synced'

// REVALIDATE all derived tables
await this.revalidateDerivedTables()
```

#### 2. After Getting Latest Mutations
```typescript
// In SyncedDb.syncMutationsFromServer()
const mutations = await this.remoteDb.get(maxTimestamp)

for (const { batch, serverTimestampMs } of mutations) {
  await this.applyMutationBatch(batch, serverTimestampMs)
}

// REVALIDATE affected derived tables
await this.revalidateDerivedTables()
```

#### 3. After Local Mutations (Optional)
When a local mutation is made to a source table, derived tables could be revalidated immediately:
```typescript
// In SyncedTable.insertWithUndo()
await this.onMutation(mutation)

// If this table is a source for derived tables, revalidate them
await this.__db__.revalidateDerivedTables(this.__meta__.name)
```

However, this may be too aggressive. Consider batching or debouncing.

---

## 4. Table Metadata

### isDerived Flag
```typescript
export interface TableMetadata {
  name: string
  dbName: string
  columns: Record<string, ColumnMetadata>
  indexes?: IndexDefinition[]
  constrains?: ConstraintDefinition[]
  renamedFrom?: string
  isDerived?: boolean // NEW: marks derived tables
  derivedFrom?: string[] // NEW: source table names this derived table depends on
}
```

### Setting Metadata
```typescript
// In o.derivedTable()
function derivedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols,
  indexesBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => any[],
  constrainsBuilder?: (t: { [K in keyof TCols]: TCols[K] }) => ConstraintDefinition[]
): DerivedTable<Name, TCols> & TCols {
  const instance = new DerivedTable<Name, TCols>({
    name,
    columns: columns as any,
    indexes: indexesBuilder ? indexesBuilder(columns as any) : [],
    constrains: constrainsBuilder ? constrainsBuilder(columns as any) : [],
  })

  // Mark as derived
  instance.__meta__.isDerived = true

  // derivedFrom will be set when derive() is called

  return instance as DerivedTable<Name, TCols> & TCols
}
```

---

## 5. DerivedTable Class

### Invalidation Context
```typescript
type DerivationContext =
  | { type: 'full' } // Full recomputation (after pull)
  | {
      type: 'incremental'
      mutationType: 'insert' | 'update' | 'delete'
      ids: string[] // IDs of affected records in source table
    }
```

### Class Definition
```typescript
export class DerivedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>> extends Table<Name, TCols> {
  private derivationFn?: (context: DerivationContext) => Promise<void>
  private sourceTables?: Table<any, any>[]

  // Called after db is created to define derivation logic
  derive(
    fn: (context: DerivationContext) => Promise<void>,
    sourceTables: Table<any, any>[]
  ): this {
    this.derivationFn = fn
    this.sourceTables = sourceTables

    // Store source table names in metadata
    this.__meta__.derivedFrom = sourceTables.map(t => t.__meta__.name)

    return this
  }

  // Internal method called by db to revalidate
  async _revalidate(context: DerivationContext): Promise<void> {
    if (!this.derivationFn) {
      throw new Error(`Derived table ${this.__meta__.name} has no derivation function`)
    }

    // Execute derivation function with context
    // The function captures db from closure
    await this.derivationFn(context)
  }
}
```

### Type Definition
```typescript
type DerivedTableInstance<Name extends string, TCols extends Record<string, Column<any, any, any>>> =
  DerivedTable<Name, TCols> & TCols & {
    derive: (
      fn: (context: DerivationContext) => Promise<void>,
      sourceTables: Table<any, any>[]
    ) => DerivedTableInstance<Name, TCols>
  }
```

---

## 6. Revalidation Strategy

### Tracking Dependencies

Dependencies are **explicitly declared** in the second argument to `derive()`:

```typescript
db.states.derive(async (context) => {
  // Derivation logic captures db from closure
  const mutations = await db.mutations.select().execute()
  // ...
}, [db.mutations]) // Explicit dependency array

// Store in metadata
this.__meta__.derivedFrom = ['mutations']
```

**Why explicit instead of automatic?**
1. **Clarity**: Developer knows exactly what triggers revalidation
2. **Performance**: No proxy overhead during derivation
3. **Reliability**: No risk of missing dependencies due to conditional access
4. **Type safety**: TypeScript can validate the dependency array

**Implementation**:
```typescript
derive(
  fn: (context: DerivationContext) => Promise<void>,
  sourceTables: Table<any, any>[]
): this {
  this.derivationFn = fn
  this.sourceTables = sourceTables

  // Extract and store source table names
  this.__meta__.derivedFrom = sourceTables.map(t => t.__meta__.name)

  return this
}
```

### Revalidation Execution

```typescript
// In Db or SyncedDb
async revalidateDerivedTables(
  sourceTableName?: string,
  context: DerivationContext = { type: 'full' }
): Promise<void> {
  const derivedTables = Object.values(this.options.schema)
    .filter(table => table.__meta__.isDerived) as DerivedTable<any, any>[]

  for (const derivedTable of derivedTables) {
    // If sourceTableName provided, only revalidate tables that depend on it
    if (sourceTableName) {
      const dependencies = derivedTable.__meta__.derivedFrom ?? []
      if (!dependencies.includes(sourceTableName)) {
        continue
      }
    }

    // Execute revalidation in transaction for consistency
    await this.transaction(async (tx) => {
      await derivedTable._revalidate(context)
    })
  }
}
```

### Incremental Updates

When a mutation is applied to a source table, we can trigger incremental revalidation:

```typescript
// In SyncedTable or when applying mutations
async applyMutationBatch(batch: DbMutationBatch, serverTimestampMs: number): Promise<void> {
  // ... apply mutations ...

  // For each mutation in the batch, trigger incremental revalidation
  for (const mutation of batch.mutation) {
    const context: DerivationContext = {
      type: 'incremental',
      mutationType: mutation.type,
      ids: mutation.type === 'insert'
        ? mutation.data.map(d => d.id)
        : mutation.type === 'update'
        ? [mutation.data.id]
        : mutation.ids
    }

    await this.revalidateDerivedTables(mutation.table, context)
  }
}
```

---

## 7. SyncedDb vs Regular Table Methods

### The Problem

`SyncedDb` wraps user tables as `SyncedTable` instances which have `insertWithUndo()`, `updateWithUndo()`, `deleteWithUndo()` methods instead of the regular `insert()`, `update()`, `delete()` methods.

**But derived tables need regular methods** because:
1. They are client-only (no sync needed)
2. We don't want to track undo for derived data (it's recomputed, not user input)
3. Derivation functions should use simple insert/update/delete

### Solution: Dual-Mode Access

Derived tables should expose **both** synced and regular methods, or provide a way to access the underlying regular table.

#### Option 1: Regular Methods on DerivedTable (Recommended)
```typescript
export class DerivedTable<Name extends string, TCols extends Record<string, Column<any, any, any>>> extends Table<Name, TCols> {
  // Regular methods (inherited from Table) work normally
  // No WithUndo variants

  async insert(data: any): Promise<any> {
    // Standard insert, no sync tracking
    return super.insert(data)
  }

  async update(options: any): Promise<void> {
    // Standard update, no sync tracking
    return super.update(options)
  }

  async delete(options: any): Promise<void> {
    // Standard delete, no sync tracking
    return super.delete(options)
  }
}
```

Since `DerivedTable` extends `Table` (not `SyncedTable`), it keeps the regular methods. The `SyncedDb` should **not** wrap derived tables as `SyncedTable`.

```typescript
// In SyncedDb.wrapTablesAsSynced()
private wrapTablesAsSynced(): void {
  for (const [name, table] of Object.entries(this.userSchema)) {
    const typedThis = this as unknown as Record<string, unknown>

    // Skip derived tables - they keep regular Table methods
    if (table.__meta__.isDerived) {
      typedThis[name] = table // Keep as-is
      continue
    }

    // Only wrap non-derived tables as SyncedTable
    const syncedTable = new SyncedTable(
      {
        name: table.__meta__.name as any,
        columns: table.__columns__,
        // ...
      },
      this.enqueueMutation.bind(this)
    )

    // ... connect to driver ...

    typedThis[name] = syncedTable
  }
}
```

#### Option 2: toRegularDb() Helper
```typescript
// Convert SyncedDb to regular Db for derivation context
function toRegularDb(syncedDb: SyncedDb): Db {
  // Create a proxy that unwraps SyncedTable to regular Table
  return new Proxy(syncedDb, {
    get(target, prop) {
      const value = target[prop]
      if (value instanceof SyncedTable) {
        // Return the underlying regular table
        return value._getRegularTable()
      }
      return value
    }
  })
}

// Usage in derivation
const db = await o.syncedDb({ schema: { mutations, states }, ... })

db.states.derive(async (context) => {
  const regularDb = toRegularDb(db)

  // Now we have regular insert/update/delete
  await regularDb.states.deleteAll()
  await regularDb.states.insert({ value: 123 })
}, [db.mutations])
```

**Recommendation**: Use Option 1. Derived tables should not be wrapped as `SyncedTable` and should retain their regular `Table` methods.

### Helper Method: deleteAll()

For convenience, add a `deleteAll()` helper to `Table`:

```typescript
// In Table class
async deleteAll(): Promise<void> {
  const driver = this.__db__.getDriver()
  const query = `DELETE FROM ${this.__meta__.dbName}`
  await driver.run({ query, params: [] })
}
```

This makes full recomputation simpler:
```typescript
db.states.derive(async (context) => {
  if (context.type === 'full') {
    await db.states.deleteAll() // Clean slate
    // Recompute from scratch
  }
}, [db.mutations])
```

---

## 8. Edge Cases & Considerations

### 8.1 Concurrent Mutations During Derivation

**Problem**: What if a mutation happens while a derivation is running?

**Solution**: Use transactions for derivation
```typescript
async _revalidate(context: DerivationContext): Promise<void> {
  if (!this.derivationFn) return

  // Run derivation in transaction for isolation
  // The derivation function captures db from closure
  await this.__db__.getDb().transaction(async (tx) => {
    await this.derivationFn(context)
  })
}
```

This ensures derivation sees a consistent snapshot of data.

**Note**: The derivation function captures `db` from the outer scope, but operates within the transaction context.

### 8.2 Derivation Function Errors

**Problem**: What if the derivation function throws an error?

**Solution**: Catch and log, don't crash sync
```typescript
async revalidateDerivedTables(sourceTableName?: string): Promise<void> {
  // ...

  for (const derivedTable of derivedTables) {
    try {
      await derivedTable._revalidate()
    } catch (error) {
      console.error(`Failed to revalidate derived table ${derivedTable.__meta__.name}:`, error)
      // Continue with other derived tables
      // Consider: Store error state on table for debugging
    }
  }
}
```

### 8.3 Circular Dependencies

**Problem**: DerivedTable A depends on DerivedTable B which depends on DerivedTable A

**Solution**: Detect cycles using topological sort
```typescript
function topologicalSort(derivedTables: DerivedTable<any, any>[]): DerivedTable<any, any>[] {
  const sorted: DerivedTable<any, any>[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(table: DerivedTable<any, any>) {
    if (visited.has(table.__meta__.name)) return
    if (visiting.has(table.__meta__.name)) {
      throw new Error(`Circular dependency detected involving ${table.__meta__.name}`)
    }

    visiting.add(table.__meta__.name)

    const deps = table.__meta__.derivedFrom ?? []
    for (const depName of deps) {
      const depTable = derivedTables.find(t => t.__meta__.name === depName)
      if (depTable) visit(depTable)
    }

    visiting.delete(table.__meta__.name)
    visited.add(table.__meta__.name)
    sorted.push(table)
  }

  for (const table of derivedTables) {
    visit(table)
  }

  return sorted
}
```

### 8.4 Partial Sync / Interrupted Pull

**Problem**: What if sync is interrupted mid-pull?

**Behavior**: Derived tables will have stale/partial data until sync completes
- Queries still work (return stale data)
- Revalidation only happens after successful sync
- No special handling needed

### 8.5 Performance: Large Derivations

**Problem**: Derivation takes a long time

**Solutions**:
1. **Incremental updates**: Instead of clearing and recomputing, compute delta
   ```typescript
   db.states.derive(async (context) => {
     if (context.type === 'incremental') {
       // Only process affected IDs
       const affectedMutations = await db.mutations
         .select({ where: sql`id IN (${context.ids.join(',')})` })
         .execute()

       for (const mut of affectedMutations) {
         const existing = await db.states.select({ where: { id: mut.id } }).execute()
         if (existing.length > 0) {
           await db.states.update({
             data: { value: existing[0].value + mut.delta },
             where: { id: mut.id }
           })
         } else {
           await db.states.insert({ id: mut.id, value: mut.delta })
         }
       }
     }
   }, [db.mutations])
   ```

2. **Background revalidation**: Don't block sync completion
   ```typescript
   this.syncState = 'synced'

   // Revalidate in background (don't await)
   this.revalidateDerivedTables().catch(err => {
     console.error('Background revalidation failed:', err)
   })
   ```

3. **Debouncing**: If mutations happen frequently, debounce revalidation
   ```typescript
   private revalidateDebounced = debounce(() => this.revalidateDerivedTables(), 1000)
   ```

### 8.6 Testing Derived Tables

**Problem**: How to test derivation logic?

**Approach**:
```typescript
describe('states derived table', () => {
  it('computes total from mutations', async () => {
    const db = await o.testDb({ schema: { mutations, states } }, driver)

    db.states.derive(async (context) => {
      if (context.type === 'full') {
        // Clear and recompute
        await db.states.deleteAll()
        const muts = await db.mutations.select().execute()
        const total = muts.reduce((sum, m) => sum + m.delta, 0)
        await db.states.insert({ value: total })
      }
    }, [db.mutations])

    // Insert mutations
    await db.mutations.insert({ delta: 10 })
    await db.mutations.insert({ delta: 20 })

    // Manually trigger revalidation (in tests)
    await db.revalidateDerivedTables(undefined, { type: 'full' })

    // Check derived state
    const states = await db.states.select().execute()
    expect(states[0].value).toBe(30)
  })
})
```

---

## 9. Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add `isDerived` and `derivedFrom` to `TableMetadata`
- [ ] Create `DerivationContext` type (full vs incremental)
- [ ] Create `DerivedTable` class extending `Table`
- [ ] Implement `derive()` method with explicit dependency tracking
- [ ] Add `o.derivedTable()` builder function
- [ ] Add `deleteAll()` helper method to `Table` class

### Phase 2: SyncedDb Integration
- [ ] Update `SyncedDb.wrapTablesAsSynced()` to skip derived tables
- [ ] Ensure derived tables keep regular `insert()`/`update()`/`delete()` methods
- [ ] Test that derived tables don't get wrapped as `SyncedTable`

### Phase 3: Origin Filtering
- [ ] Update `getSchema()` to filter derived tables when `origin !== 'client'`
- [ ] Update `getSchemaDefinition()` to skip derived tables
- [ ] Update `buildSnapshotFromSchema()` to skip derived tables
- [ ] Test that server DBs don't see derived tables

### Phase 4: Revalidation
- [ ] Add `revalidateDerivedTables()` method to `Db` with context parameter
- [ ] Implement topological sort for dependency order
- [ ] Add full revalidation after sync completion (`{ type: 'full' }`)
- [ ] Add incremental revalidation after mutation application (`{ type: 'incremental', ... }`)

### Phase 5: Query Execution
- [ ] Ensure derived table queries never proxy during sync
- [ ] Ensure derived table queries always use local driver
- [ ] Test query behavior in all sync states

### Phase 6: Edge Cases & Polish
- [ ] Handle derivation errors gracefully
- [ ] Detect circular dependencies
- [ ] Add optional incremental derivation support
- [ ] Add debouncing for frequent mutations
- [ ] Write comprehensive tests

---

## 10. Alternative: Virtual Derived Tables

Instead of materializing derived tables in SQLite, we could compute them on-the-fly:

```typescript
const states = o.virtualDerivedTable('states', {
  id: o.id(),
  value: o.integer()
})

db.states.derive(async (context) => {
  // Return computed data, don't insert into DB
  const muts = await db.mutations.select().execute()
  const total = muts.reduce((sum, m) => sum + m.delta, 0)
  return [{ id: 'state-1', value: total }]
}, [db.mutations])

// When querying
const states = await db.states.select().execute() // Calls derive function
```

**Pros**:
- No storage overhead
- Always fresh data
- Simpler (no revalidation needed)

**Cons**:
- Slower queries (recompute every time)
- Can't index derived data
- Can't query with complex WHERE clauses
- Not suitable for large derivations

**Recommendation**: Start with materialized approach. Add virtual option later if needed.

---

## 11. Example Use Cases

### Use Case 1: Aggregate State
```typescript
const mutations = o.table('mutations', {
  id: o.id(),
  entityId: o.idFk(),
  delta: o.integer()
})

const entityStates = o.derivedTable('entityStates', {
  entityId: o.id(),
  total: o.integer()
})

db.entityStates.derive(async (context) => {
  if (context.type === 'full') {
    await db.entityStates.deleteAll()

    const muts = await db.mutations.select().execute()
    const totals = new Map<string, number>()

    for (const mut of muts) {
      const current = totals.get(mut.entityId) ?? 0
      totals.set(mut.entityId, current + mut.delta)
    }

    for (const [entityId, total] of totals) {
      await db.entityStates.insert({ entityId, total })
    }
  } else {
    // Incremental: recalculate only affected entities
    const affectedMuts = await db.mutations
      .select({ where: sql`id IN (${context.ids.join(',')})` })
      .execute()

    // Get unique entity IDs
    const entityIds = [...new Set(affectedMuts.map(m => m.entityId))]

    for (const entityId of entityIds) {
      const entityMuts = await db.mutations
        .select({ where: { entityId } })
        .execute()

      const total = entityMuts.reduce((sum, m) => sum + m.delta, 0)

      // Upsert the total
      const existing = await db.entityStates.select({ where: { entityId } }).execute()
      if (existing.length > 0) {
        await db.entityStates.update({ data: { total }, where: { entityId } })
      } else {
        await db.entityStates.insert({ entityId, total })
      }
    }
  }
}, [db.mutations])
```

### Use Case 2: Denormalized Join
```typescript
const users = o.table('users', {
  id: o.id(),
  name: o.text()
})

const posts = o.table('posts', {
  id: o.id(),
  userId: o.idFk(),
  title: o.text()
})

const postsWithAuthors = o.derivedTable('postsWithAuthors', {
  id: o.id(),
  title: o.text(),
  authorName: o.text()
})

db.postsWithAuthors.derive(async (context) => {
  if (context.type === 'full') {
    await db.postsWithAuthors.deleteAll()

    const posts = await db.posts.select().execute()
    const users = await db.users.select().execute()
    const usersMap = new Map(users.map(u => [u.id, u]))

    for (const post of posts) {
      const author = usersMap.get(post.userId)
      await db.postsWithAuthors.insert({
        id: post.id,
        title: post.title,
        authorName: author?.name ?? 'Unknown'
      })
    }
  } else {
    // Incremental: only update affected posts
    const affectedPosts = await db.posts
      .select({ where: sql`id IN (${context.ids.join(',')})` })
      .execute()

    const users = await db.users.select().execute()
    const usersMap = new Map(users.map(u => [u.id, u]))

    for (const post of affectedPosts) {
      const author = usersMap.get(post.userId)
      const existing = await db.postsWithAuthors.select({ where: { id: post.id } }).execute()

      if (existing.length > 0) {
        await db.postsWithAuthors.update({
          data: { title: post.title, authorName: author?.name ?? 'Unknown' },
          where: { id: post.id }
        })
      } else {
        await db.postsWithAuthors.insert({
          id: post.id,
          title: post.title,
          authorName: author?.name ?? 'Unknown'
        })
      }
    }
  }
}, [db.posts, db.users])
```

### Use Case 3: Time-Series Rollup
```typescript
const events = o.table('events', {
  id: o.id(),
  timestamp: o.date(),
  value: o.integer()
})

const dailyStats = o.derivedTable('dailyStats', {
  date: o.text(), // ISO date string
  count: o.integer(),
  sum: o.integer(),
  avg: o.real()
})

db.dailyStats.derive(async (context) => {
  if (context.type === 'full') {
    await db.dailyStats.deleteAll()

    const events = await db.events.select().execute()
    const byDate = new Map<string, number[]>()

    for (const event of events) {
      const dateKey = event.timestamp.toISOString().split('T')[0]
      if (!byDate.has(dateKey)) byDate.set(dateKey, [])
      byDate.get(dateKey)!.push(event.value)
    }

    for (const [date, values] of byDate) {
      const sum = values.reduce((a, b) => a + b, 0)
      await db.dailyStats.insert({
        date,
        count: values.length,
        sum,
        avg: sum / values.length
      })
    }
  } else {
    // Incremental: recalculate affected dates
    const affectedEvents = await db.events
      .select({ where: sql`id IN (${context.ids.join(',')})` })
      .execute()

    const affectedDates = [...new Set(affectedEvents.map(e =>
      e.timestamp.toISOString().split('T')[0]
    ))]

    for (const date of affectedDates) {
      const dateEvents = await db.events
        .select({ where: sql`date(timestamp) = ${date}` })
        .execute()

      const sum = dateEvents.reduce((a, e) => a + e.value, 0)
      const count = dateEvents.length

      const existing = await db.dailyStats.select({ where: { date } }).execute()
      if (existing.length > 0) {
        await db.dailyStats.update({
          data: { count, sum, avg: sum / count },
          where: { date }
        })
      } else {
        await db.dailyStats.insert({ date, count, sum, avg: sum / count })
      }
    }
  }
}, [db.events])
```

---

## 12. Future Enhancements

1. **Selective Revalidation**: Only revalidate derived tables affected by specific mutations
2. **Streaming Derivation**: For large datasets, process in chunks
3. **Derivation Status API**: Expose whether derived tables are up-to-date
4. **Manual Invalidation**: Allow manual triggering of revalidation
5. **Derivation Hooks**: `onBeforeDerive`, `onAfterDerive` lifecycle hooks
6. **Partial Updates**: Smart diffing to only update changed rows
7. **Virtual Tables**: Compute-on-read option for simple derivations
8. **Parallel Revalidation**: Revalidate independent derived tables in parallel
