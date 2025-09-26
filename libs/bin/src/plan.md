# Overview

we need to build a typesafe orm for sqlite. This refined plan stays in sync with the current code and highlights what's done vs next.

```tsx
columns:
  id: string
  text
  integer
  real
  date: Date // js date serialized to unix timestamp (stored as integer)
  enum: 'a' | 'b' | 'c' // stored as integer
  json
  boolean
constrains:
  primaryKey
  unique
  index
```

column definition class methods

```tsx
__meta__: ColumnMetadata ✅
__table__: { getName: () => string } // reference to parent ✅

notNull ✅ (sets insertType='required')
default ✅ (sets SQL default via encode if provided; keeps insertType='optional'; updates appDefault)
unique ✅
primaryKey ✅
references(() => table.column) // foreign key ✅
generatedAlwaysAs // virtual/derived column ✅
$defaultFn(() => new Date()) // called when we insert a new row ✅ (keeps insertType='optional')
$onUpdateFn(() => new Date()) // called when we update a row ⏭️
$type<Type>() // override the ts type of the column ✅
encode(fn) / decode(fn) // app<->sql transformation; default() uses encode for SQL default ✅
```

schema example

```tsx
const table = b.table('table',
  {
    id: b.id(),
    name: b.text(),
    age: b.integer(),
    height: b.real(),
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
// runtime storage type used by SQLite. camelCase in TS; SQL uses UPPERCASE on emission
type ColumnType = 'integer' | 'real' | 'text' | 'blob'
// application-level interpretation of stored value
type ApplicationType = 'json' | 'date' | 'ulid' | 'boolean' | 'enum' | undefined
// insertion type classification
type InsertionType = 'required' | 'optional' | 'virtual'

// Serializable on-disk/in-SQL metadata (no functions)
interface SerializableColumnMetadata { // ✅ (non-generic)
  name: string
  type: ColumnType
  notNull?: boolean
  generatedAlwaysAs?: string // SQL expression string ✅
  primaryKey?: boolean
  foreignKey?: string // `${table}.${column}` ✅
  unique?: boolean
  default?: number | string | boolean | null ✅
  appType?: ApplicationType
}

// In-memory metadata (superset of serializable)
interface ColumnMetadata extends SerializableColumnMetadata { // ✅ (non-generic)
  insertType: InsertionType
  serverTime?: boolean
  appDefault?: (() => unknown) | unknown ✅
  encode?: (data: unknown) => number | string ✅
  decode?: (data: number | string) => unknown ✅
  aliasedFrom?: string
  definition?: string // eg COUNT(*) for virtual columns
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
__meta__: TableMetadata ✅
__db__: { getDriver: () => BinDriver }

make(overrides: Partial<InsertableTableData<this>>): SelectableTableData<this>

// on table class instance all its columns are accessable: users.age
insert({
 data: InsertableTableData // TableData is a generic type that ensures proper typesafey
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

__selectionType__: SelectableTableData<this> ✅
__insertionType__: InsertableTableData<this> ✅ // eg type InsertUser = db.users.__insertionType__

// where examples
users.id.eq(inputData.id)
sql`${users.id.eq(inputData.id)} AND ${users.age.gte(inputData.minAge)}`
```

current builder decisions

```tsx
b.text()     // appDefault: '' ✅
b.integer()  // appDefault: 0 ✅
b.real()     // appDefault: 0 ✅
b.date()     // appDefault: new Date() ✅ (stored as INTEGER)
b.boolean()  // appDefault: false ✅
b.json(zod)  // appDefault derived from schema ✅
b.id()       // appDefault fn () => nanoid() ✅

constructor(schema: Record<string, Table>, opts: { origin: 'client' | 'server'}){}

transaction: (cb: () => void): Promise<void>
query(strings: TemplateStringsArray, ...values: any[]): { execute: (zodSchema: T) => Promise<infer<T>> }

_connectDriver: (driver: BinDriver) => void
_connectUser(user: any): void
getSchemaDefinition: () => string // emits CREATE TABLE + INDEX ✅
_getSchemaSnapshot(prev?: SchemaSnapshot) ⏭️
_clear ⏭️

interface SchemaSnapshot {
  id: string // timestamp-randomSuffix
  name: string
  tables: {
    name: string
    columns: Record<string, SerializableColumnMetadata>
    indexes?: string[][]
    constrains?: string[][]
  }
}
