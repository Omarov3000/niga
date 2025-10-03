import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Date schema definition
export interface DateSchemaDef extends types.SchemaTypeDef {
  type: "date";
}

export interface DateSchemaInternals extends types.SchemaInternals<Date, Date | string> {
  def: DateSchemaDef;
  bag: util.LoosePartial<{
    minimum: Date;
    maximum: Date;
  }>;
}

export interface DateSchema extends types.Schema<Date, Date | string, DateSchemaInternals> {
  min(date: Date, message?: string | { message: string | (() => string) }): this;
  max(date: Date, message?: string | { message: string | (() => string) }): this;
  parse(data: unknown, params?: types.ParseContext): Date;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: Date } | { success: false; error: errors.SchemaError };
}

export const DateSchema = types.$constructor<DateSchema>("DateSchema", (inst, def: DateSchemaDef) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    let date: Date;

    // Support string input (like Zod)
    if (typeof payload.value === "string") {
      try {
        date = new Date(payload.value);
      } catch (_) {
        payload.issues.push({
          code: "invalid_type",
          expected: "date",
          input: payload.value,
          inst,
        });
        return payload;
      }
    } else if (payload.value instanceof Date) {
      date = payload.value;
    } else {
      payload.issues.push({
        code: "invalid_type",
        expected: "date",
        input: payload.value,
        inst,
      });
      return payload;
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      payload.issues.push({
        code: "invalid_type",
        expected: "date",
        received: "Invalid Date",
        input: payload.value,
        inst,
      });
      return payload;
    }

    payload.value = date;
    return payload;
  };

  const createCheck = (checkFn: types.CheckFn<Date>, onattach: (schema: any) => void = () => {}) => ({
    _zod: {
      def: { check: "custom" },
      check: checkFn,
      onattach: [onattach],
    },
  });

  const addCheck = (check: types.Check<Date>) => {
    return new DateSchema({
      ...def,
      checks: [...(def.checks ?? []), check],
    });
  };

  inst.min = (date, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value.getTime() >= date.getTime()) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_small",
            type: "date",
            minimum: date.getTime(),
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.minimum;
          if (!curr || date.getTime() > curr.getTime()) {
            schema._zod.bag.minimum = date;
          }
        }
      )
    );
  };

  inst.max = (date, message) => {
    const getMessage = () => (typeof message === "string" ? message : message?.message);
    return addCheck(
      createCheck(
        (payload) => {
          if (payload.value.getTime() <= date.getTime()) return;
          const msg = getMessage();
          payload.issues.push({
            code: "too_big",
            type: "date",
            maximum: date.getTime(),
            inclusive: true,
            input: payload.value,
            inst,
            ...(msg ? { message: typeof msg === "function" ? msg() : msg } : {}),
          });
        },
        (schema) => {
          const curr = schema._zod.bag.maximum;
          if (!curr || date.getTime() < curr.getTime()) {
            schema._zod.bag.maximum = date;
          }
        }
      )
    );
  };
});

export function date(message?: string | { message: string | (() => string) }): DateSchema {
  return new DateSchema({
    type: "date",
    ...(message ? { error: typeof message === "string" ? message : message.message } : {}),
  });
}
