import { BaseSchema } from "../core/base-schema";
import * as types from "../core/types";

// Custom schema - allows custom type with validation
export interface CustomSchemaDef<T> extends types.SchemaTypeDef {
  type: "custom";
  validate: (data: T) => boolean | Promise<boolean>;
  message?: string | (() => string);
}

export interface CustomSchema<T> extends types.Schema<T, T> {
  parse(data: unknown, params?: types.ParseContext): T;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: T } | { success: false; error: any };
}

export const CustomSchema: types.$constructor<CustomSchema<any>, CustomSchemaDef<any>> = types.$constructor(
  "CustomSchema",
  (inst: CustomSchema<any>, def: CustomSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, ctx) => {
      const isValid = def.validate(payload.value);

      if (isValid instanceof Promise) {
        return isValid.then((valid) => {
          if (!valid) {
            const msg = def.message ? (typeof def.message === "function" ? def.message() : def.message) : undefined;
            payload.issues.push({
              code: "custom",
              input: payload.value,
              inst,
              ...(msg ? { message: msg } : {}),
            });
          }
          return payload;
        });
      }

      if (!isValid) {
        const msg = def.message ? (typeof def.message === "function" ? def.message() : def.message) : undefined;
        payload.issues.push({
          code: "custom",
          input: payload.value,
          inst,
          ...(msg ? { message: msg } : {}),
        });
      }

      return payload;
    };
  }
);

export function custom<T>(
  validate: (data: T) => boolean | Promise<boolean>,
  message?: string | { message: string | (() => string) }
): CustomSchema<T> {
  return new CustomSchema({
    type: "custom",
    validate,
    message: typeof message === "string" ? message : message?.message,
  });
}
