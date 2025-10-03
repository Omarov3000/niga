import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";

// InstanceOf schema definition
export interface InstanceOfSchemaDef<T extends new (...args: any[]) => any> extends types.SchemaTypeDef {
  type: "instanceof";
  class: T;
}

export interface InstanceOfSchemaInternals<T extends new (...args: any[]) => any>
  extends types.SchemaInternals<InstanceType<T>, InstanceType<T>> {
  def: InstanceOfSchemaDef<T>;
}

export interface InstanceOfSchema<T extends new (...args: any[]) => any>
  extends types.Schema<InstanceType<T>, InstanceType<T>, InstanceOfSchemaInternals<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): InstanceType<T>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: InstanceType<T> } | { success: false; error: errors.SchemaError };
}

export const InstanceOfSchema = types.$constructor<InstanceOfSchema<any>>(
  "InstanceOfSchema",
  (inst, def: InstanceOfSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, _ctx) => {
      if (payload.value instanceof def.class) return payload;

      payload.issues.push({
        code: "invalid_type",
        expected: def.class.name || "class instance",
        input: payload.value,
        inst,
      });
      return payload;
    };
  }
);

export function _instanceof<T extends new (...args: any[]) => any>(class_: T): InstanceOfSchema<T> {
  return new InstanceOfSchema({
    type: "instanceof",
    class: class_,
  });
}
