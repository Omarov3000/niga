import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";
import type { OptionalSchema } from "./wrappers";
import { optional as makeOptional } from "./wrappers";

// Number schema definition
export interface NumberSchemaDef extends types.SchemaTypeDef {
  type: "number";
}

export interface NumberSchemaInternals extends types.SchemaInternals<number, number> {
  def: NumberSchemaDef;
  bag: util.LoosePartial<{
    minimum: number;
    maximum: number;
    int: boolean;
  }>;
}

export interface NumberSchema extends types.Schema<number, number, NumberSchemaInternals> {
  int(message?: string | { message: string | (() => string) }): this;
  positive(message?: string | { message: string | (() => string) }): this;
  negative(message?: string | { message: string | (() => string) }): this;
  gt(value: number, message?: string | { message: string | (() => string) }): this;
  gte(value: number, message?: string | { message: string | (() => string) }): this;
  min(value: number, message?: string | { message: string | (() => string) }): this;
  lt(value: number, message?: string | { message: string | (() => string) }): this;
  lte(value: number, message?: string | { message: string | (() => string) }): this;
  max(value: number, message?: string | { message: string | (() => string) }): this;
  optional(): OptionalSchema<this>;
  parse(data: unknown, params?: types.ParseContext): number;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: number } | { success: false; error: errors.SchemaError };
}

export const NumberSchema = types.$constructor<NumberSchema>("NumberSchema", (inst, def: NumberSchemaDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value === "number" && !isNaN(payload.value)) return payload;

    payload.issues.push({
      code: "invalid_type",
      expected: "number",
      input: payload.value,
      inst,
    });
    return payload;
  };

  const createCheck = (checkFn: types.CheckFn<number>, onattach: (schema: any) => void = () => {}) => ({
    _zod: {
      def: { check: "custom" },
      check: checkFn,
      onattach: [onattach],
    },
  });

  const addCheck = (check: types.Check<number>) => {
    return new NumberSchema({
      ...def,
      checks: [...(def.checks ?? []), check],
    });
  };

  inst.int = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (Number.isInteger(payload.value)) return;
          const msg = getMessage();
          payload.issues.push({
            code: "custom",
            input: payload.value,
            inst,
            message: msg ? (typeof msg === "function" ? msg() : msg) : "Expected integer, received float",
          });
        },
        (schema) => {
          schema._zod.bag.int = true;
        }
      )
    );
  };

  inst.positive = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value > 0) return;
        const msg = getMessage();
        payload.issues.push({
          code: "too_small",
          type: "number",
          minimum: 0,
          inclusive: false,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.negative = (message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value < 0) return;
        const msg = getMessage();
        payload.issues.push({
          code: "too_big",
          type: "number",
          maximum: 0,
          inclusive: false,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.gt = (value, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value > value) return;
        const msg = getMessage();
        payload.issues.push({
          code: "too_small",
          type: "number",
          minimum: value,
          inclusive: false,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.gte = (value, message) => {
    return inst.min(value, message);
  };

  inst.min = (value, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value >= value) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_small",
            type: "number",
            minimum: value,
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.minimum ?? -Infinity;
          if (value > curr) schema._zod.bag.minimum = value;
        }
      )
    );
  };

  inst.lt = (value, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck((payload) => {
        if (payload.value < value) return;
        const msg = getMessage();
        payload.issues.push({
          code: "too_big",
          type: "number",
          maximum: value,
          inclusive: false,
          input: payload.value,
          inst,
          ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
        });
      })
    );
  };

  inst.lte = (value, message) => {
    return inst.max(value, message);
  };

  inst.max = (value, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value <= value) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_big",
            type: "number",
            maximum: value,
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.maximum ?? Infinity;
          if (value < curr) schema._zod.bag.maximum = value;
        }
      )
    );
  };

  inst.optional = () => {
    return makeOptional(inst);
  };
});

export function number(message?: string | { message: string | (() => string) }): NumberSchema {
  return new NumberSchema({
    type: "number",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}
