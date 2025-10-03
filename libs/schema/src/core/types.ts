import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as constructor from "./constructor";
import type * as errors from "./errors";
import type * as util from "./util";

// Parse context
export interface ParseContext {
  error?: errors.ErrorMap;
  async?: boolean;
}

export interface ParsePayload<T = unknown> {
  value: T;
  issues: errors.RawIssue[];
  aborted?: boolean;
}

export type CheckFn<T> = (payload: ParsePayload<T>) => util.MaybeAsync<void>;

// Base schema definition
export interface SchemaTypeDef {
  type: string;
  error?: errors.ErrorMap | string | (() => string);
  checks?: Check<any>[];
  meta?: Record<string, any>;
  [key: string]: any; // Allow extra properties for specific schema types
}

// Check (validator) interface
export interface Check<T = any> {
  _zod: {
    def: { check: string; error?: errors.ErrorMap | string | (() => string); abort?: boolean };
    check: CheckFn<T>;
    onattach: ((schema: any) => void)[];
  };
}

// Base schema internals (hidden in _zod property)
export interface BaseSchemaInternals {
  def: SchemaTypeDef;
  traits: Set<string>;
  constr: new (def: any) => any;
  deferred?: util.AnyFunc[];
  bag: Record<string, unknown>;
  meta?: Record<string, any>;
  output?: unknown;
  input?: unknown;

  // Parse and validation functions
  parse(payload: ParsePayload, ctx: ParseContext): util.MaybeAsync<ParsePayload>;
  run(payload: ParsePayload, ctx: ParseContext): util.MaybeAsync<ParsePayload>;
}

// Schema internals with typed input/output
export interface SchemaInternals<out O = unknown, out I = unknown> extends BaseSchemaInternals {
  output: O;
  input: I;
  optin?: "optional";
  optout?: "optional";
}

// Minimal schema type for constraints (allows circular references)
export type SomeSchema = { _zod: BaseSchemaInternals };

// Base schema interface
export interface Schema<
  O = unknown,
  I = unknown,
  Internals extends SchemaInternals<O, I> = SchemaInternals<O, I>,
> extends SomeSchema {
  _zod: Internals;
  "~standard": StandardSchemaV1.Props<I, O>;
}

// Type helpers for extracting input/output
export type input<T> = T extends { _zod: { input: any } } ? T["_zod"]["input"] : unknown;
export type output<T> = T extends { _zod: { output: any } } ? T["_zod"]["output"] : unknown;
export type infer<T> = output<T>;

// Base constructor type
export const $constructor = constructor.$constructor;
export type $constructor<T extends { _zod: any }, D = any> = constructor.$constructor<T, D>;

// Re-export utilities
export const NEVER = constructor.NEVER;
export const AsyncError = constructor.AsyncError;
