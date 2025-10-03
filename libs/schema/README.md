# @w/schema

A high-performance, TypeScript-first schema validation library compatible with Zod API and StandardSchemaV1 specification.

## Features

- ✅ **Zod-compatible API** - Drop-in replacement for most Zod use cases
- ✅ **StandardSchemaV1 compliant** - Works with any tool supporting the standard
- ✅ **Optimized TypeScript performance** - Uses covariant types and structural separation for fast type checking
- ✅ **Comprehensive validation** - String, number, date, object, array, union, and more
- ✅ **Type inference** - Full TypeScript type inference with `s.infer<>`
- ✅ **Transforms & refinements** - Custom validation and data transformation
- ✅ **Self-referencing schemas** - Support for recursive types via getters

## Installation

```bash
pnpm add @w/schema
```

## Usage

```typescript
import { s } from "@w/schema";

// Define a schema
const Player = s.object({
  username: s.string(),
  xp: s.number(),
});

// Parse with error throwing
const player = Player.parse({ username: "player1", xp: 100 });

// Safe parse (returns result object)
const result = Player.safeParse({ username: 42, xp: "100" });
if (!result.success) {
  console.log(result.error.issues); // Detailed error information
} else {
  console.log(result.data); // Parsed data
}

// Type inference
type Player = s.infer<typeof Player>;
// { username: string; xp: number }
```

## API Reference

### Primitives

- `s.string()` - String validation
- `s.number()` - Number validation
- `s.boolean()` - Boolean validation
- `s.date()` - Date validation (supports string parsing)
- `s.null()` - Null validation
- `s.undefined()` - Undefined validation
- `s.unknown()` - Unknown type (always passes)

### String Methods

```typescript
s.string()
  .min(5)                    // Minimum length
  .max(10)                   // Maximum length
  .length(8)                 // Exact length
  .regex(/pattern/)          // Regex pattern
  .startsWith("prefix")      // Starts with
  .endsWith("suffix")        // Ends with
  .includes("substring")     // Contains
  .email()                   // Email validation
  .httpUrl()                 // HTTP/HTTPS URL
  .uppercase()               // Transform to uppercase
  .lowercase()               // Transform to lowercase
  .trim()                    // Trim whitespace
```

### Number Methods

```typescript
s.number()
  .int()                     // Integer only
  .positive()                // > 0
  .negative()                // < 0
  .gt(5)                     // Greater than
  .gte(5) / .min(5)          // Greater than or equal
  .lt(10)                    // Less than
  .lte(10) / .max(10)        // Less than or equal
```

### Date Methods

```typescript
s.date()
  .min(new Date())           // Minimum date
  .max(new Date())           // Maximum date
```

### Complex Types

```typescript
// Literal
s.literal("admin")

// Enum
s.enum(["admin", "user", "guest"])
const schema = s.enum(["a", "b"]);
schema.options; // ["a", "b"]

// Instance of
s.instanceof(MyClass)

// Object
s.object({
  name: s.string(),
  age: s.number(),
})
  .shape                     // Access shape
  .extend({ email: s.string() })  // Extend
  .pick("name", "age")       // Pick fields
  .omit("email")             // Omit fields
  .partial()                 // Make all optional

// Array
s.array(s.string())

// Record
s.record(s.string(), s.number())

// Union
s.union([s.string(), s.number()])

// Discriminated Union
s.discriminatedUnion("type", [
  s.object({ type: s.literal("a"), value: s.string() }),
  s.object({ type: s.literal("b"), value: s.number() }),
])
```

### Modifiers

```typescript
// Custom validation
s.refine(
  s.string(),
  (val) => val.length > 0,
  { message: "String must not be empty" }
)

// Transform
s.transform(s.string(), (val) => val.length)

// Default value
s.default(s.string(), "default")

// Catch errors
s.catch(s.number(), 0) // Returns 0 if parsing fails
```

### Self-Referencing Types

```typescript
const Category = s.object({
  name: s.string(),
  get subcategories() {
    return s.array(Category);
  },
});

type Category = s.infer<typeof Category>;
// { name: string; subcategories: Category[] }
```

### Error Handling

```typescript
try {
  schema.parse(data);
} catch (error) {
  if (error instanceof s.SchemaError) {
    error.issues; // Array of validation issues
    /*
    [
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['username'],
        message: 'Invalid input: expected string'
      }
    ]
    */
  }
}
```

### Custom Error Messages

```typescript
// As string
s.string({ message: "Custom error" })

// As function
s.string({ message: () => "Custom error" })

// Per validator
s.string().min(5, { message: () => "Too short!" })
```

## TypeScript Performance

This library is optimized for fast TypeScript type checking using:

- **Covariant output types** (`out` modifier) - Speeds up assignability checks
- **Structural separation** - Complex types deferred in `_zod` namespace
- **Computed metadata caching** - Pre-computed values in `bag` property
- **Conditional type short-circuits** - Fast paths for common cases
- **Prettify helpers** - Forces type computation and caching

## StandardSchemaV1 Integration

All schemas implement the `~standard` property:

```typescript
const schema = s.string();
const result = schema["~standard"].validate("hello");
// { value: "hello" } or { issues: [...] }
```

## Architecture

```
src/
├── core/
│   ├── types.ts           # Base types and interfaces
│   ├── constructor.ts     # Schema constructor pattern
│   ├── util.ts            # Type utilities
│   ├── errors.ts          # Error handling
│   └── base-schema.ts     # Base schema implementation
├── schemas/
│   ├── string.ts          # String schema
│   ├── number.ts          # Number schema
│   ├── primitives.ts      # Boolean, null, undefined, unknown
│   ├── date.ts            # Date schema
│   ├── literal.ts         # Literal schema
│   ├── enum.ts            # Enum schema
│   ├── instanceof.ts      # InstanceOf schema
│   ├── array.ts           # Array schema
│   ├── record.ts          # Record schema
│   ├── object.ts          # Object schema
│   ├── union.ts           # Union schemas
│   └── wrappers.ts        # Refine, transform, default, catch
└── index.ts               # Public API
```

## License

MIT
