import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";
import type { OptionalSchema } from "./wrappers";
import { optional as makeOptional } from "./wrappers";

// String schema definition
export interface StringSchemaDef extends types.SchemaTypeDef {
  type: "string";
}

export interface StringSchemaInternals extends types.SchemaInternals<string, string> {
  def: StringSchemaDef;
  bag: util.LoosePartial<{
    minimum: number;
    maximum: number;
    patterns: Set<RegExp>;
  }>;
}

export interface StringSchema extends types.Schema<string, string, StringSchemaInternals> {
  min(length: number, message?: string | { message: string | (() => string) }): this;
  max(length: number, message?: string | { message: string | (() => string) }): this;
  length(length: number, message?: string | { message: string | (() => string) }): this;
  regex(pattern: RegExp, message?: string | { message: string | (() => string) }): this;
  startsWith(prefix: string, message?: string | { message: string | (() => string) }): this;
  endsWith(suffix: string, message?: string | { message: string | (() => string) }): this;
  includes(substring: string, message?: string | { message: string | (() => string) }): this;
  email(message?: string | { message: string | (() => string) }): this;
  httpUrl(message?: string | { message: string | (() => string) }): this;
  uppercase(message?: string | { message: string | (() => string) }): this;
  lowercase(message?: string | { message: string | (() => string) }): this;
  trim(): this;
  optional(): OptionalSchema<this>;
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): string;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: string } | { success: false; error: errors.SchemaError };
}

export const StringSchema = types.$constructor<StringSchema>("StringSchema", (inst, def: StringSchemaDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value === "string") return payload;

    payload.issues.push({
      code: "invalid_type",
      expected: "string",
      input: payload.value,
      inst,
    });
    return payload;
  };

  // Helper to create check
  const createCheck = (checkFn: types.CheckFn<string>, onattach: (schema: any) => void = () => {}) => ({
    _zod: {
      def: { check: "custom" },
      check: checkFn,
      onattach: [onattach],
    },
  });

  // Add a check to the schema
  const addCheck = (check: types.Check<string>) => {
    return new StringSchema({
      ...def,
      checks: [...(def.checks ?? []), check],
    });
  };

  inst.min = (length, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value.length >= length) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_small",
            type: "string",
            minimum: length,
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.minimum ?? 0;
          if (length > curr) schema._zod.bag.minimum = length;
        }
      )
    );
  };

  inst.max = (length, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value.length <= length) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_big",
            type: "string",
            maximum: length,
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.maximum ?? Infinity;
          if (length < curr) schema._zod.bag.maximum = length;
        }
      )
    );
  };

  inst.length = (length, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value.length === length) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "regex",
          input: payload.value,
          inst,
          message: msg ? (typeof msg === "function" ? msg() : msg) : `String must be exactly ${length} characters`,
        });
      })
    );
  };

  inst.regex = (pattern, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (pattern.test(payload.value)) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "regex",
          pattern: pattern.source,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.startsWith = (prefix, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value.startsWith(prefix)) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "startsWith",
          value: prefix,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.endsWith = (suffix, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value.endsWith(suffix)) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "endsWith",
          value: suffix,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.includes = (substring, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value.includes(substring)) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "includes",
          value: substring,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.email = (message) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (emailRegex.test(payload.value)) return;
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "email",
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.httpUrl = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        try {
          const url = new URL(payload.value);
          if (url.protocol === "http:" || url.protocol === "https:") return;
        } catch (_) {
          // Fall through to error
        }
        const msg = getMessage();
        payload.issues.push({
          code: "invalid_string",
          validation: "url",
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.uppercase = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        payload.value = payload.value.toUpperCase();
      })
    );
  };

  inst.lowercase = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        payload.value = payload.value.toLowerCase();
      })
    );
  };

  inst.trim = () => {
    return addCheck(
      createCheck((payload) => {
        payload.value = payload.value.trim();
      })
    );
  };

  inst.optional = () => {
    return makeOptional(inst);
  };
});

export function string(message?: string | { message: string | (() => string) }): StringSchema {
  return new StringSchema({
    type: "string",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}
