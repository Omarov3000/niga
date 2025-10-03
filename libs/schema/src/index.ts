// Core types and utilities
export type { input, output, infer, Schema, ParseContext } from "./core/types";
export { SchemaError } from "./core/errors";
export type { Issue } from "./core/errors";

// Import all schema constructors
import * as errors from "./core/errors";
import { string } from "./schemas/string";
import { number } from "./schemas/number";
import { boolean, _null, _undefined, unknown } from "./schemas/primitives";
import { date } from "./schemas/date";
import { literal } from "./schemas/literal";
import { _enum } from "./schemas/enum";
import { _instanceof } from "./schemas/instanceof";
import { array } from "./schemas/array";
import { record } from "./schemas/record";
import { object } from "./schemas/object";
import { union, discriminatedUnion } from "./schemas/union";
import { refine, transform, _default, _catch, optional } from "./schemas/wrappers";
import { custom } from "./schemas/custom";
import { _function } from "./schemas/function";

// Export schema types
export type { StringSchema } from "./schemas/string";
export type { NumberSchema } from "./schemas/number";
export type { BooleanSchema, NullSchema, UndefinedSchema, UnknownSchema } from "./schemas/primitives";
export type { DateSchema } from "./schemas/date";
export type { LiteralSchema } from "./schemas/literal";
export type { EnumSchema } from "./schemas/enum";
export type { InstanceOfSchema } from "./schemas/instanceof";
export type { ArraySchema } from "./schemas/array";
export type { RecordSchema } from "./schemas/record";
export type { ObjectSchema, Shape } from "./schemas/object";
export type { UnionSchema, DiscriminatedUnionSchema } from "./schemas/union";
export type { RefineSchema, TransformSchema, DefaultSchema, CatchSchema, OptionalSchema } from "./schemas/wrappers";
export type { CustomSchema } from "./schemas/custom";
export type { FunctionSchema } from "./schemas/function";

// Main API object
export const s = {
  // Primitives
  string,
  number,
  boolean,
  null: _null,
  undefined: _undefined,
  unknown,
  date,

  // Special types
  literal,
  enum: _enum,
  instanceof: _instanceof,

  // Complex types
  object,
  array,
  record,
  union,
  discriminatedUnion,
  function: _function,

  // Wrappers/modifiers
  refine,
  transform,
  default: _default,
  catch: _catch,
  optional,
  custom,

  // Error class
  SchemaError: errors.SchemaError,
};

// Type inference helpers
import type { Schema, SomeSchema, input as InputType, output as OutputType } from "./core/types";
import type { StringSchema as _StringSchema } from "./schemas/string";
import type { NumberSchema as _NumberSchema } from "./schemas/number";
import type { BooleanSchema as _BooleanSchema, NullSchema as _NullSchema, UndefinedSchema as _UndefinedSchema, UnknownSchema as _UnknownSchema } from "./schemas/primitives";
import type { DateSchema as _DateSchema } from "./schemas/date";
import type { LiteralSchema as _LiteralSchema } from "./schemas/literal";
import type { EnumSchema as _EnumSchema } from "./schemas/enum";
import type { InstanceOfSchema as _InstanceOfSchema } from "./schemas/instanceof";
import type { ArraySchema as _ArraySchema } from "./schemas/array";
import type { RecordSchema as _RecordSchema } from "./schemas/record";
import type { ObjectSchema as _ObjectSchema, Shape as _Shape } from "./schemas/object";
import type { UnionSchema as _UnionSchema, DiscriminatedUnionSchema as _DiscriminatedUnionSchema } from "./schemas/union";
import type { RefineSchema as _RefineSchema, TransformSchema as _TransformSchema, DefaultSchema as _DefaultSchema, CatchSchema as _CatchSchema, OptionalSchema as _OptionalSchema } from "./schemas/wrappers";
import type { CustomSchema as _CustomSchema } from "./schemas/custom";
import type { FunctionSchema as _FunctionSchema } from "./schemas/function";

// Type inference helpers as namespace
export namespace s {
  export type infer<T> = OutputType<T>;
  export type input<T> = T extends Schema ? InputType<T> : never;
  export type output<T> = T extends Schema ? OutputType<T> : never;

  // Schema types
  export type StringSchema = _StringSchema;
  export type NumberSchema = _NumberSchema;
  export type BooleanSchema = _BooleanSchema;
  export type NullSchema = _NullSchema;
  export type UndefinedSchema = _UndefinedSchema;
  export type UnknownSchema = _UnknownSchema;
  export type DateSchema = _DateSchema;
  export type LiteralSchema<T extends string | number | boolean> = _LiteralSchema<T>;
  export type EnumSchema<T extends readonly [string, ...string[]]> = _EnumSchema<T>;
  export type InstanceOfSchema<T extends new (...args: any) => any> = _InstanceOfSchema<T>;
  export type ArraySchema<T> = _ArraySchema<T>;
  export type RecordSchema<K extends Schema, V extends Schema> = _RecordSchema<K, V>;
  export type ObjectSchema<T extends _Shape> = _ObjectSchema<T>;
  export type Shape = _Shape;
  export type UnionSchema<T extends readonly [Schema, Schema, ...Schema[]]> = _UnionSchema<T>;
  export type DiscriminatedUnionSchema<K extends string, T extends readonly [Schema, Schema, ...Schema[]]> = _DiscriminatedUnionSchema<K, T>;
  export type RefineSchema<T extends Schema> = _RefineSchema<T>;
  export type TransformSchema<T extends Schema, Out> = _TransformSchema<T, Out>;
  export type DefaultSchema<T extends Schema> = _DefaultSchema<T>;
  export type CatchSchema<T extends Schema> = _CatchSchema<T>;
  export type OptionalSchema<T extends Schema> = _OptionalSchema<T>;
  export type CustomSchema<T> = _CustomSchema<T>;
  export type FunctionSchema<Input extends readonly Schema[], Output extends Schema | undefined> = _FunctionSchema<Input, Output>;
}

// Default export
export default s;
