import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Array schema definition
export interface ArraySchemaDef<T> extends types.SchemaTypeDef {
  type: "array";
  element: T;
}

export interface ArraySchemaInternals<T>
  extends types.SchemaInternals<types.output<T>[], types.input<T>[]> {
  def: ArraySchemaDef<T>;
}

export interface ArraySchema<T>
  extends types.Schema<types.output<T>[], types.input<T>[], ArraySchemaInternals<T>> {
  parse(data: unknown, params?: types.ParseContext): types.output<T>[];
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T>[] } | { success: false; error: errors.SchemaError };
}

export const ArraySchema = types.$constructor<ArraySchema<any>>("ArraySchema", (inst, def: ArraySchemaDef<any>) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, ctx) => {
    if (!Array.isArray(payload.value)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "array",
        input: payload.value,
        inst,
      });
      return payload;
    }

    const input = payload.value;
    const result: any[] = [];
    const promises: Promise<any>[] = [];

    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const itemPayload = def.element._zod.run({ value: item, issues: [] }, ctx);

      if (itemPayload instanceof Promise) {
        promises.push(
          itemPayload.then((p) => {
            if (p.issues.length > 0) {
              payload.issues.push(...util.prefixIssues(i, p.issues));
            }
            result[i] = p.value;
          })
        );
      } else {
        if (itemPayload.issues.length > 0) {
          payload.issues.push(...util.prefixIssues(i, itemPayload.issues));
        }
        result[i] = itemPayload.value;
      }
    }

    if (promises.length > 0) {
      return Promise.all(promises).then(() => {
        payload.value = result;
        return payload;
      });
    }

    payload.value = result;
    return payload;
  };
});

export function array<T>(element: T): ArraySchema<T> {
  return new ArraySchema({
    type: "array",
    element: element as any,
  }) as any;
}
