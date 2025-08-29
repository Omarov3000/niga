# Overview

we need to build a typesafe orm for sqlite. This is very crude draft on how it should look like

```tsx
columns:
  id: string
  text
  integer
  real
  date: Date // js date that is serialized to unix timestamp
  enum: 'a' | 'b' | 'c'. enum: <const T extends s>(arr: readonly T[], default_: NoInfer<T>) // in db we store integer
  json
  boolean
constrains:
  primaryKey
  unique
  index
```

column definition class methods:

```tsx
__meta__: ColumnMetadata
__table__: { getName: () => string} // reference to parent

notNull
default
unique
primaryKey
references(() => table.column) // foreign key
generatedAlwaysAs
$defaultFn(() => new Date()) // called when we insert a new row
$onUpdateFn(() => new Date()) // called when we update a row
$type<Type>() // override the ts type of the column
```

schema example

```tsx
const table = b.table('table',
  {
	  id: b.id(),
	  name: b.text(),
	  age: b.integer(),
	  height: b.double(),
	  generatedName: b.text().generatedAlwaysAs(
	    (): Sql => sql`hi, ${table.name}!`
	  ),
	},
  (table) => [index().on(table.name, table.age)],
  // simple security checks
 ).secure((table, checks) => (query, user: { id: string; role: 'admin' }) => {
	  switch query.type
	    case 'delete':
	      if (user.role === 'admin') return true // RBAC
	      return false
	    case 'update':
	    case 'insert':
	    case 'select':
        if (checks.hasWhereClauseCheck(query.accessedTables, table.id.equalityCheck(user.id))) return true // ABAC

    return false
  })

class Sql { query: string; params: any[] }
```

column metadata

```tsx
type ColumnType = 'integer' | 'real' | 'text',
type ApplicationType = 'json' | 'date' | 'ulid'
type InsertionType = 'required' | 'optional' | 'virtual' // virtual: eg MAX(name)

interface SerializableColumnMetadata<
  Name extends string,
  Type extends ColumnType,
  AppType extends ApplicationType
> {
  name: Name
  type: Type
  notNull?: boolean
  generatedAlwaysAs?: string
  primaryKey?: boolean
  foreingKey?: string
  unique?: boolean
  default?: number | string
  appType?: AppType
}

interface ColumnMetadata<
  TableName extends string,
  Name extends string,
  Type extends ColumnType,
  AppType extends ApplicationType,
  InsertType extends InsertionType
> extends SerializableColumnMetadata<Name, Type, AppType>
  insertType: InsertType
  serverTime?: boolean
  appDefault: (() => Type) | Type
  encode?: (data: NonNullable<Type>) => n | s // to db
  decode?: (data: n | s) => Type // from db
  aliasedFrom?: string
  definition?: string // eg COUNT(*) - for virtual columns in queries
}
```

column class methods

```tsx
__meta__: ColumnMetadata
__table__: { getName: () => string} // reference to parent

eq(value: Type): FilterObject
ne(value: Type): FilterObject
like(value: s): FilterObject
notLike(value: s): FilterObject
gt(value: Type): FilterObject
gte(value: Type): FilterObject
lt(value: Type): FilterObject
lte(value: Type): FilterObject
between(value1: Type, value2: Type): FilterObject
notBetween(value1: Type, value2: Type): FilterObject
isNull(): FilterObject
isNotNull(): FilterObject
inArray(values: Type[]): FilterObject
notInArray(values: Type[]): FilterObject

count(): Column<..., "virtual">
max(): Column<..., "virtual">
increment(): Column<..., "virtual">

asc(): OrderObject
desc(): OrderObject

matches(col: Column): FilterObject // employee.managerId.matches(hierarchy.id)

// security rules typesafe helpers
equalityCheck(value: Type): { tableName, columnName, value, operator }

as<T>(alias: T): Column<...>
```

table metadata

```tsx
interface SerializableTableMetadata<Name extends string, Columns extends Record<string, Column>> {
  name: Name
  columns: Columns
  indexes?: string[][]
  constrains?: string[][]
}

interface TableMetadata extends SerializableTableMetadata {
  aliasedFrom?: string
}
```

table class methods

```tsx
__meta__: TableMetadata
__db__: { getDriver: () => BinDriver } // parent reference

// on table class instance all its columns are accessable: users.age
insert({
 data: InsertableTableData // TableData is a generic type that ensures proper typesafey
 returning?: '*'
}): Promise

update({
  data: Partial<InsertableTableData<this>>
  where: Sql
}): Promise

delete({
  data: SelectableTableData
  where: Sql
}): Promise

as(alias: Name)

selectionType: SelectableTableData<this>
insertionType: InsertableTableData<this> // eg type InsertUser = db.users.insertionType

// where examples
users.id.eq(inputData.id)
sql`${users.id.eq(inputData.id)} AND ${users.age.gte(inputData.minAge)}`
```

db object methods

```tsx
// on db class instance all its table are accessable: db.users

constructor(schema: Record<string, Table>, opts: { origin: 'client' | 'server'}){}

transaction: (cb: () => void): Promise<void>
query(strings: TemplateStringsArray, ...values: any[]): { execute: (zodSchema: T) => Promise<infer<T>> }

_connectDriver: (driver: BinDriver) => Promise<void>
_getSchemaDefinition
_getSchemaSnapshot(prev?: SchemaSnapshot)
_clear

interface SchemaSnapshot {
  id: string // timestamp-randomSuffix
  name: string
  tables:{
	  name: string
	  columns: Record<string, SerializableColumnMetadata>
	  indexes?: string[][]
	  constrains?: string[][]
	}
}

interface BinDriver {
  exec: (sql: string) => any
  run: (sql: StructuredSql) => any
}

// usage
import * as schema from 'schema'
const db = b.db({
  schema,
  // advanced security rules (note this db should run queiries without security checks to avoid dead locks
}).secure(async (db) => (query, user: { id: string }) => {
    const { type } = db.query`select ${db.groups.type} from ${db.groups} where ${db.groups.userId.eq(user.id)}`.executeAndTakeFirst({ type: z.enum(['moderators']) })
    if (type == 'moderators') return true
    return false
  })

```

node driver

```tsx
import Database from 'better-sqlite3'

export class BinNodeDriver implements BinDriver {
  db: ReturnType<typeof Database>

  constructor(public path = ':memory:') {
    this.db = new Database(path)
  }

  exec = (sql: string) => {
    safeSplit(sql, ';').forEach((s) => this.db.exec(s))
  }

  run = ({sql, params}: StructuredSql) => {
    const q = this.db.prepare(sql)
    if (sql.startsWith('SELECT')) return q.all(params)
    q.run(params)
    return []
  }
}

```

# Phase 1

## 🎯 Phase 1 Goals
- Implement **core schema definition**:
  - `Column` class with metadata
  - `Table` class with metadata
  - `Db` class with `_getSchemaDefinition()`
- Support **basic column types** (`integer`, `real`, `text`, `date`, `json`, `boolean`, `enum`)
- Support **constraints** (`primaryKey`, `unique`, `index`)
- Implement **serialization** of schema into a string (for snapshot/testing)
- Write **tests with Vitest** that:
  - Define a schema
  - Call `_getSchemaDefinition()`
  - Compare against expected string using `dedent`

---

## 🏗 Implementation Plan

### 1. Column Definition
- Create a `Column` class that stores:
  - `name`
  - `type` (SQLite type: `INTEGER`, `REAL`, `TEXT`, `BLOB`)
  - `appType` (optional: `date`, `json`, `boolean`, `enum`)
  - constraints: `notNull`, `primaryKey`, `unique`, `default`, `references`
- Provide builder functions in `b` object:
  ```ts
  b.text()
  b.integer()
  b.real()
  b.date()
  b.json()
  b.boolean()
  b.enum(['a', 'b', 'c'], 'a')
  b.id() // shorthand for primary key text/uuid
  ```

### 2. Table Definition
- `Table` class:
  - Holds `name`
  - Holds `columns` (map of `Column`)
  - Holds `indexes` and `constraints`
- Builder:
  ```ts
  const users = b.table("users", {
    id: b.id(),
    name: b.text().notNull(),
    age: b.integer(),
  }, (t) => [
    b.index().on(t.name)
  ])
  ```

### 3. Schema Definition
- `Db` class:
  - Accepts schema (map of tables)
  - Implements `_getSchemaDefinition()`:
    - Iterates over tables
    - Serializes each table into a `CREATE TABLE` statement
    - Serializes indexes
- Example output:
  ```sql
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER
  );

  CREATE INDEX users_name_idx ON users(name);
  ```

### 4. Testing Strategy
- Use **Vitest** + **dedent** for snapshot-like tests
- Example test:
  ```ts
  import { describe, it, expect } from "vitest"
  import dedent from "dedent"
  import { b } from "../src/builder"

  describe("schema definition", () => {
    it("should generate schema for users table", () => {
      const users = b.table("users", {
        id: b.id(),
        name: b.text().notNull(),
        age: b.integer(),
      })

      const db = b.db({ schema: { users } })
      expect(db._getSchemaDefinition()).toBe(dedent`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          age INTEGER
        );
      `)
    })
  })
  ```

---

## 📂 Phase 1 File Structure

```
src/
  builder.ts        // entry point with b.table, b.text, etc.
  column.ts         // Column class + metadata
  table.ts          // Table class + metadata
  db.ts             // Db class + schema serialization
  types.ts          // shared types
tests/
  schema.test.ts    // Vitest tests for schema definition
```

---

## ✅ Deliverables for Phase 1
- [ ] `Column` class with metadata + builder functions
- [ ] `Table` class with metadata + builder
- [ ] `Db` class with `_getSchemaDefinition()`
- [ ] Serialization to SQL string
- [ ] Vitest tests with `dedent`
