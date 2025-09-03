# TypeScript Optional Property Generation Error in zodSchema.test.ts

## Problem Summary

The zod schema generation for insert operations is not correctly creating optional TypeScript properties. Instead of generating truly optional properties (`key?: Type`), it creates required properties that accept undefined values (`key: Type | undefined`). This causes TypeScript compiler failures in test type assertions.

## How We Discovered the Problem

### 1. Initial Investigation
- **Symptom**: TypeScript compiler errors `Type 'false' does not satisfy the constraint 'true'` on lines 1044 and 1089
- **Context**: Errors in `Expect<Equal<ResultType, Expected>>` type assertions
- **Method**: Ran `pnpm tsc --noEmit` to get exact error locations

### 2. Examining Actual vs Expected Types
We created a test case and found the actual `ResultType`:

```typescript
const users = b.table('users', {
  id: b.id(),                    // insertType = 'withDefault'
  isActive: b.boolean().notNull(), // insertType = 'required'
  visible: b.boolean(),          // insertType = 'optional'
  createdAt: b.date().notNull(), // insertType = 'required'
  updatedAt: b.date(),           // insertType = 'optional'
});

const schema = makeInsertSchema(users);
const result = schema.parse({...});

type ResultType = typeof result;
// Actual result:
{
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;               // ❌ Required, should be optional
  id: string | undefined;        // ❌ Union type, should be optional property
  visible: boolean | undefined;  // ❌ Union type, should be optional property
}

// Expected (what tests assume):
{
  id?: string;        // ✅ Optional property
  isActive: boolean;
  visible?: boolean;  // ✅ Optional property
  createdAt: Date;
  updatedAt?: Date;   // ✅ Optional property
}
```

## Root Cause: Type-Level Mapping Issue

The problem is in the **compile-time TypeScript type mapping**, specifically in `ColumnToZodType`:

```typescript
type ColumnToZodType<TCol extends Column<any, any, any>> =
  TCol extends Column<any, infer Type, infer InsertType> ?
    InsertType extends 'virtual' ? never :
    InsertType extends 'withDefault' ? z.ZodOptional<z.ZodType<Type>> :
    InsertType extends 'optional' ? z.ZodOptional<z.ZodType<Type>> :
    z.ZodType<Type>
  : never;
```

**The Issue**: `z.ZodOptional<z.ZodType<Type>>` creates union types (`Type | undefined`) rather than optional properties (`key?: Type`) when used in a `z.ZodObject`.

## Expected vs Actual Behavior

### What Should Happen (Logically)
For insert schemas:
- `insertType: 'withDefault'` → `key?: Type` (optional - has default)
- `insertType: 'optional'` → `key?: Type` (optional - can be null/undefined)
- `insertType: 'required'` → `key: Type` (required - must be provided)

### What Actually Happens (Current Implementation)
- `insertType: 'withDefault'` → `key: Type | undefined` (required property, union type)
- `insertType: 'optional'` → `key: Type | undefined` (required property, union type)
- `insertType: 'required'` → `key: Type` (required property) ✅ Correct

## The Core TypeScript Problem

This is a fundamental difference between:
- **Property optionality**: `{ key?: string }` (property may be omitted)
- **Value optionality**: `{ key: string | undefined }` (property required, value may be undefined)

The current type mapping creates value optionality when we need property optionality.

## Evidence Summary

1. **Compile-time errors**: Type assertions failing because actual types don't match expected optional properties
2. **Runtime logic**: Columns with `insertType: 'optional'` and `'withDefault'` should logically be optional in insert operations
3. **Type inspection**: Actual zod schema types show union types instead of optional properties
4. **Builder changes**: Removing `appDefault` correctly changed column `insertType` values, but type mapping didn't handle this properly

The fix requires updating the TypeScript type-level transformations to create truly optional properties rather than required properties with union types.
