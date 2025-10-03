Based on schema.md, we need to implement:

Core Types

- Primitives: s.string(), s.number(), s.boolean(), s.date(),
s.undefined(), s.null(), s.unknown()
- Special Types: s.literal(), s.instanceof(), s.enum()
- Complex Types: s.object(), s.array(), s.record(), s.union(),
s.discriminatedUnion()

String Validators

- Length checks: .min(), .max(), .length()
- Pattern checks: .regex(), .startsWith(), .endsWith(), .includes()
- Format validators: .email(), .httpUrl()
- Transforms: .uppercase(), .lowercase(), .trim()

Number Validators

- Type checks: .int(), .positive(), .negative()
- Comparisons: .gt(), .gte() (min), .lt(), .lte() (max)

Date Validators

- Range: .min(), .max()
- String parsing support (like Zod)

Object Methods

- .shape, .extend(), .pick(), .omit(), .partial()
- Self-reference support via getters

Common Methods (all schemas)

- .parse() - throws on error
- .safeParse() - returns result object
- .refine() - custom validation
- .transform() - value transformation
- .default() - default values
- .catch() - fallback on error

Type Inference

- s.infer<typeof schema> - output type
- s.input<typeof schema> - input type
- s.output<typeof schema> - output type (explicit)

Error Handling

- s.SchemaError class with .issues array
- Custom error messages via options

2. TypeScript Performance Optimization Strategy

Based on Zod's approach, we'll use these techniques:

A. Structural Separation Pattern

// Separate internals from public interface
interface $ZodTypeInternals<out O, out I> {
  output: O;  // Deferred type computation
  input: I;
}

interface $ZodType<O, I, Internals> {
  _zod: Internals;  // Hide complexity in _zod namespace
}

Why: TypeScript only computes types on-demand. By hiding types in _zod, we
  defer expensive type operations until needed.

B. Covariant Output Types (out modifier)

interface $ZodTypeInternals<out O = unknown, out I = unknown>

Why: The out modifier makes type parameters covariant, allowing TypeScript
  to skip expensive variance checks. This dramatically speeds up
assignability checks in unions and complex schemas.

C. Conditional Type Distribution Control

// Use explicit distribution control for object inference
type $InferObjectOutput<T, Extra> =
  string extends keyof T  // Fast path for index signatures
    ? Record<string, unknown>
    : util.Prettify<{...}>  // Slow path only when needed

Why: Short-circuit expensive mapped types when possible. Check for simple
cases first.

D. Utility Type Helpers

type Flatten<T> = Identity<{ [k in keyof T]: T[k] }>;
type Prettify<T> = { [K in keyof T]: T[K] } & {};

Why: These force TypeScript to compute types once and cache results,
rather than re-computing on every reference.

E. Schema Definition Separation

// Runtime definition (minimal)
interface $ZodStringDef {
  type: "string";
  checks?: Check[];
}

// Type-level information (computed lazily)
interface $ZodStringInternals<Input> extends $ZodTypeInternals<string,
Input> {
  def: $ZodStringDef;
  isst: IssueType;  // Pre-computed issue types
  bag: { minimum?: number; maximum?: number };  // Metadata
}

Why: Keep runtime objects small. Use bag for computed metadata. TypeScript
  can optimize this better than constantly recomputing from checks array.

F. Fast Path Patterns

// Store pre-computed values in _zod.bag
inst._zod.bag.minimum = value;  // Runtime
// TypeScript reads from bag type, no recomputation needed

Why: Avoid re-walking check arrays. Pre-compute and cache in bag.

G. Avoid Deep Recursion

// Good: Iterative type building
type Union<T> = T[0] | T[1] | T[2]

// Bad: Recursive type building
type Union<T> = T extends [infer H, ...infer R]
  ? H | Union<R> : never

Why: TypeScript has recursion limits and recursive types are slow to
check.

3. Implementation Structure

libs/schema/src/
├── core/
│   ├── types.ts           # Base $ZodType, internals interfaces
│   ├── constructor.ts     # $constructor helper from zod-core
│   ├── util.ts            # Type utilities (Prettify, Flatten, etc)
│   └── errors.ts          # SchemaError, issue types
├── schemas/
│   ├── string.ts          # String schema + validators
│   ├── number.ts          # Number schema + validators
│   ├── boolean.ts         # Boolean schema
│   ├── date.ts            # Date schema + validators
│   ├── literal.ts         # Literal schema
│   ├── enum.ts            # Enum schema
│   ├── object.ts          # Object schema + methods
│   ├── array.ts           # Array schema
│   ├── record.ts          # Record schema
│   ├── union.ts           # Union schemas
│   └── primitives.ts      # null, undefined, unknown
├── checks/
│   ├── base.ts            # Check infrastructure
│   ├── string.ts          # String-specific checks
│   └── number.ts          # Number-specific checks
├── parse.ts               # parse/safeParse implementation
├── standard-schema.ts     # StandardSchemaV1 integration
└── index.ts               # Public API (s.string(), etc)

4. Key Implementation Details

Standard Schema Integration

Every schema will implement '~standard' property with validate() method
that returns { value } or { issues }.

Constructor Pattern

Use Zod's $constructor pattern for efficient class-like behavior with
traits system.

Check System

Checks (validators) are separate objects attached to schemas via checks
array. They have onattach hooks to populate bag metadata.

Performance-Critical Paths

1. Object type inference: Most complex, needs careful optimization
2. Union type handling: Use covariance, avoid deep recursion
3. Array/Record inference: Keep simple, avoid conditional type explosion
