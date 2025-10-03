import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Record schema definition
export interface RecordSchemaDef<K extends types.Schema, V extends types.Schema> extends types.SchemaTypeDef {
  type: "record";
  keySchema: K;
  valueSchema: V;
}

export interface RecordSchemaInternals<K extends types.Schema, V extends types.Schema>
  extends types.SchemaInternals<
    Record<types.output<K> & PropertyKey, types.output<V>>,
    Record<types.input<K> & PropertyKey, types.input<V>>
  > {
  def: RecordSchemaDef<K, V>;
}

export interface RecordSchema<K extends types.Schema, V extends types.Schema>
  extends types.Schema<
    Record<types.output<K> & PropertyKey, types.output<V>>,
    Record<types.input<K> & PropertyKey, types.input<V>>,
    RecordSchemaInternals<K, V>
  > {
  parse(data: unknown, params?: types.ParseContext): Record<types.output<K> & PropertyKey, types.output<V>>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ):
    | { success: true; data: Record<types.output<K> & PropertyKey, types.output<V>> }
    | { success: false; error: errors.SchemaError };
}

export const RecordSchema = types.$constructor<RecordSchema<any, any>>(
  "RecordSchema",
  (inst, def: RecordSchemaDef<any, any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, ctx) => {
      if (typeof payload.value !== "object" || payload.value === null || Array.isArray(payload.value)) {
        payload.issues.push({
          code: "invalid_type",
          expected: "object",
          input: payload.value,
          inst,
        });
        return payload;
      }

      const input = payload.value as Record<string, any>;
      const result: Record<string, any> = {};
      const promises: Promise<any>[] = [];

      for (const key in input) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;

        // Validate key
        const keyPayload = def.keySchema._zod.run({ value: key, issues: [] }, ctx);
        // Validate value
        const valuePayload = def.valueSchema._zod.run({ value: input[key], issues: [] }, ctx);

        const handleResults = (kp: types.ParsePayload, vp: types.ParsePayload) => {
          if (kp.issues.length > 0) {
            payload.issues.push(...util.prefixIssues(key, kp.issues));
          }
          if (vp.issues.length > 0) {
            payload.issues.push(...util.prefixIssues(key, vp.issues));
          }
          const resultKey = kp.value as string | number;
          result[resultKey] = vp.value;
        };

        if (keyPayload instanceof Promise || valuePayload instanceof Promise) {
          promises.push(
            Promise.all([
              keyPayload instanceof Promise ? keyPayload : Promise.resolve(keyPayload),
              valuePayload instanceof Promise ? valuePayload : Promise.resolve(valuePayload),
            ]).then(([kp, vp]) => handleResults(kp, vp))
          );
        } else {
          handleResults(keyPayload, valuePayload);
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
  }
);

export function record<K extends types.Schema, V extends types.Schema>(
  keySchema: K,
  valueSchema: V
): RecordSchema<K, V> {
  return new RecordSchema({
    type: "record",
    keySchema,
    valueSchema,
  });
}
