import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";

// Boolean
export interface BooleanSchema extends types.Schema<boolean, boolean> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): boolean;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: boolean } | { success: false; error: errors.SchemaError };
}

export const BooleanSchema = types.$constructor<BooleanSchema>("BooleanSchema", (inst, def: types.SchemaTypeDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value === "boolean") return payload;

    payload.issues.push({
      code: "invalid_type",
      expected: "boolean",
      input: payload.value,
      inst,
    });
    return payload;
  };
});

export function boolean(message?: string | { message: string | (() => string) }): BooleanSchema {
  return new BooleanSchema({
    type: "boolean",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}

// Null
export interface NullSchema extends types.Schema<null, null> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): null;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: null } | { success: false; error: errors.SchemaError };
}

export const NullSchema = types.$constructor<NullSchema>("NullSchema", (inst, def: types.SchemaTypeDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    if (payload.value === null) return payload;

    payload.issues.push({
      code: "invalid_type",
      expected: "null",
      input: payload.value,
      inst,
    });
    return payload;
  };
});

export function _null(message?: string | { message: string | (() => string) }): NullSchema {
  return new NullSchema({
    type: "null",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}

// Undefined
export interface UndefinedSchema extends types.Schema<undefined, undefined> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): undefined;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: undefined } | { success: false; error: errors.SchemaError };
}

export const UndefinedSchema = types.$constructor<UndefinedSchema>(
  "UndefinedSchema",
  (inst, def: types.SchemaTypeDef) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, _ctx) => {
      if (payload.value === undefined) return payload;

      payload.issues.push({
        code: "invalid_type",
        expected: "undefined",
        input: payload.value,
        inst,
      });
      return payload;
    };
  }
);

export function _undefined(message?: string | { message: string | (() => string) }): UndefinedSchema {
  return new UndefinedSchema({
    type: "undefined",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}

// Unknown
export interface UnknownSchema extends types.Schema<unknown, unknown> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): unknown;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: unknown } | { success: false; error: errors.SchemaError };
}

export const UnknownSchema = types.$constructor<UnknownSchema>("UnknownSchema", (inst, def: types.SchemaTypeDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    // Always succeeds
    return payload;
  };
});

export function unknown(message?: string | { message: string | (() => string) }): UnknownSchema {
  return new UnknownSchema({
    type: "unknown",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}
