import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Object shape type - use any to allow recursive types
export type Shape = Record<string, any>;

// Check if schema is optional (for type inference)
type OptionalSchema = { _zod: { optin?: "optional"; optout?: "optional" } };

// Infer object output type
export type InferObjectOutput<T extends Shape> = util.Prettify<
  {
    -readonly [K in keyof T as T[K] extends OptionalSchema
      ? T[K]["_zod"]["optout"] extends "optional"
        ? never
        : K
      : K]: T[K]["_zod"]["output"];
  } & {
    -readonly [K in keyof T as T[K] extends OptionalSchema ? (T[K]["_zod"]["optout"] extends "optional" ? K : never) : never]?: T[K]["_zod"]["output"];
  }
>;

// Infer object input type
export type InferObjectInput<T extends Shape> = util.Prettify<
  {
    -readonly [K in keyof T as T[K] extends OptionalSchema
      ? T[K]["_zod"]["optin"] extends "optional"
        ? never
        : K
      : K]: T[K]["_zod"]["input"];
  } & {
    -readonly [K in keyof T as T[K] extends OptionalSchema ? (T[K]["_zod"]["optin"] extends "optional" ? K : never) : never]?: T[K]["_zod"]["input"];
  }
>;

// Object schema definition
export interface ObjectSchemaDef<T extends Shape> extends types.SchemaTypeDef {
  type: "object";
  shape: T;
}

export interface ObjectSchemaInternals<T extends Shape>
  extends types.SchemaInternals<InferObjectOutput<T>, InferObjectInput<T>> {
  def: ObjectSchemaDef<T>;
}

export interface ObjectSchema<T extends Shape>
  extends types.Schema<InferObjectOutput<T>, InferObjectInput<T>, ObjectSchemaInternals<T>> {
  readonly shape: T;
  extend<U extends Shape>(extension: U): ObjectSchema<util.Extend<T, U>>;
  pick<K extends keyof T>(...keys: K[]): ObjectSchema<Pick<T, K>>;
  omit<K extends keyof T>(...keys: K[]): ObjectSchema<Omit<T, K>>;
  partial(): ObjectSchema<{ [K in keyof T]: OptionalWrap<T[K]> }>;
  parse(data: unknown, params?: types.ParseContext): InferObjectOutput<T>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: InferObjectOutput<T> } | { success: false; error: errors.SchemaError };
}

// Helper to wrap schema in optional
type OptionalWrap<T extends types.SomeSchema> = T & { _zod: { optout: "optional" } };

export const ObjectSchema = types.$constructor<ObjectSchema<any>>(
  "ObjectSchema",
  (inst, def: ObjectSchemaDef<any>) => {
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

      // Process shape properties
      for (const key in def.shape) {
        if (!Object.prototype.hasOwnProperty.call(def.shape, key)) continue;

        const propSchema = def.shape[key];
        const propValue = input[key];

        // Check if property is missing and not optional
        if (propValue === undefined && !propSchema._zod.optin) {
          payload.issues.push({
            code: "invalid_type",
            expected: "defined",
            input: undefined,
            path: [key],
            inst,
          });
          continue;
        }

        // Skip if undefined and optional
        if (propValue === undefined && propSchema._zod.optin) {
          continue;
        }

        const propPayload = propSchema._zod.run({ value: propValue, issues: [] }, ctx);

        if (propPayload instanceof Promise) {
          promises.push(
            propPayload.then((p) => {
              if (p.issues.length > 0) {
                payload.issues.push(...util.prefixIssues(key, p.issues));
              }
              // Only set if not optional output or has value
              if (p.value !== undefined || !propSchema._zod.optout) {
                result[key] = p.value;
              }
            })
          );
        } else {
          if (propPayload.issues.length > 0) {
            payload.issues.push(...util.prefixIssues(key, propPayload.issues));
          }
          // Only set if not optional output or has value
          if (propPayload.value !== undefined || !propSchema._zod.optout) {
            result[key] = propPayload.value;
          }
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

    Object.defineProperty(inst, "shape", {
      value: def.shape,
      enumerable: true,
    });

    inst.extend = (extension) => {
      return new ObjectSchema({
        type: "object",
        shape: { ...def.shape, ...extension },
      });
    };

    inst.pick = (...keys) => {
      const picked: any = {};
      for (const key of keys) {
        picked[key] = def.shape[key];
      }
      return new ObjectSchema({
        type: "object",
        shape: picked,
      });
    };

    inst.omit = (...keys) => {
      const omitted: any = { ...def.shape };
      for (const key of keys) {
        delete omitted[key];
      }
      return new ObjectSchema({
        type: "object",
        shape: omitted,
      });
    };

    inst.partial = () => {
      const partial: any = {};
      for (const key in def.shape) {
        const schema = def.shape[key];
        // Mark as optional by setting optin and optout
        partial[key] = Object.create(schema, {
          _zod: {
            value: { ...schema._zod, optin: "optional", optout: "optional" },
            enumerable: false,
          },
        });
      }
      return new ObjectSchema({
        type: "object",
        shape: partial,
      });
    };
  }
);

export function object<T extends Shape>(shape: T): ObjectSchema<util.Writeable<T>> {
  return new ObjectSchema({
    type: "object",
    shape: shape as any,
  }) as any;
}
