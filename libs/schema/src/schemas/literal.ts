import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Literal schema definition
export interface LiteralSchemaDef<T extends util.Literal> extends types.SchemaTypeDef {
  type: "literal";
  value: T;
}

export interface LiteralSchemaInternals<T extends util.Literal> extends types.SchemaInternals<T, T> {
  def: LiteralSchemaDef<T>;
}

export interface LiteralSchema<T extends util.Literal> extends types.Schema<T, T, LiteralSchemaInternals<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): T;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: T } | { success: false; error: errors.SchemaError };
}

export const LiteralSchema = types.$constructor<LiteralSchema<any>>(
  "LiteralSchema",
  (inst, def: LiteralSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, _ctx) => {
      if (payload.value === def.value) return payload;

      payload.issues.push({
        code: "invalid_literal",
        expected: def.value,
        input: payload.value,
        inst,
      });
      return payload;
    };
  }
);

export function literal<T extends util.Literal>(value: T): LiteralSchema<T> {
  return new LiteralSchema({
    type: "literal",
    value,
  });
}
