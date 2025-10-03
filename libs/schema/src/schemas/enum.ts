import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";

// Enum schema definition
export interface EnumSchemaDef<T extends readonly [string, ...string[]]> extends types.SchemaTypeDef {
  type: "enum";
  values: T;
}

export interface EnumSchemaInternals<T extends readonly [string, ...string[]]>
  extends types.SchemaInternals<T[number], T[number]> {
  def: EnumSchemaDef<T>;
}

export interface EnumSchema<T extends readonly [string, ...string[]]>
  extends types.Schema<T[number], T[number], EnumSchemaInternals<T>> {
  readonly options: T;
  parse(data: unknown, params?: types.ParseContext): T[number];
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: T[number] } | { success: false; error: errors.SchemaError };
}

export const EnumSchema = types.$constructor<EnumSchema<any>>("EnumSchema", (inst, def: EnumSchemaDef<any>) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, _ctx) => {
    if (def.values.includes(payload.value)) return payload;

    payload.issues.push({
      code: "invalid_enum_value",
      options: def.values,
      input: payload.value,
      inst,
    });
    return payload;
  };

  Object.defineProperty(inst, "options", {
    value: def.values,
    enumerable: true,
  });
});

export function _enum<const T extends readonly [string, ...string[]]>(values: T): EnumSchema<T> {
  return new EnumSchema({
    type: "enum",
    values,
  });
}
