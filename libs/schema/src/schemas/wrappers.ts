import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";

// Refine wrapper - adds custom validation
export interface RefineSchemaDef<T extends types.Schema> extends types.SchemaTypeDef {
  type: "refine";
  schema: T;
  refinement: (data: types.output<T>) => boolean | Promise<boolean>;
  message?: string | (() => string);
}

export interface RefineSchema<T extends types.Schema>
  extends types.Schema<types.output<T>, types.input<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T> } | { success: false; error: errors.SchemaError };
}

export const RefineSchema: types.$constructor<RefineSchema<any>, RefineSchemaDef<any>> = types.$constructor(
  "RefineSchema",
  (inst: RefineSchema<any>, def: RefineSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, ctx) => {
      // First parse with underlying schema
      const result = def.schema._zod.run(payload, ctx);

      if (result instanceof Promise) {
        return result.then(async (r) => {
          if (r.issues.length > 0) return r;

          const isValid = await def.refinement(r.value);
          if (!isValid) {
            const msg = def.message ? (typeof def.message === "function" ? def.message() : def.message) : undefined;
            r.issues.push({
              code: "custom",
              input: r.value,
              inst,
              ...(msg ? { message: msg } : {}),
            });
          }
          return r;
        });
      }

      if (result.issues.length > 0) return result;

      const isValid = def.refinement(result.value);
      if (isValid instanceof Promise) {
        return isValid.then((valid) => {
          if (!valid) {
            const msg = def.message ? (typeof def.message === "function" ? def.message() : def.message) : undefined;
            result.issues.push({
              code: "custom",
              input: result.value,
              inst,
              ...(msg ? { message: msg } : {}),
            });
          }
          return result;
        });
      }

      if (!isValid) {
        const msg = def.message ? (typeof def.message === "function" ? def.message() : def.message) : undefined;
        result.issues.push({
          code: "custom",
          input: result.value,
          inst,
          ...(msg ? { message: msg } : {}),
        });
      }

      return result;
    };
  }
);

export function refine<T extends types.Schema>(
  schema: T,
  refinement: (data: types.output<T>) => boolean | Promise<boolean>,
  message?: string | { message: string | (() => string) }
): RefineSchema<T> {
  return new RefineSchema({
    type: "refine",
    schema,
    refinement,
    message: typeof message === "string" ? message : message?.message,
  });
}

// Transform wrapper - transforms output
export interface TransformSchemaDef<T extends types.Schema, Out> extends types.SchemaTypeDef {
  type: "transform";
  schema: T;
  transform: (data: types.output<T>) => Out | Promise<Out>;
}

export interface TransformSchema<T extends types.Schema, Out>
  extends types.Schema<Out, types.input<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): Out;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: Out } | { success: false; error: errors.SchemaError };
}

export const TransformSchema: types.$constructor<TransformSchema<any, any>, TransformSchemaDef<any, any>> = types.$constructor(
  "TransformSchema",
  (inst: TransformSchema<any, any>, def: TransformSchemaDef<any, any>) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, ctx) => {
      // First parse with underlying schema
      const result = def.schema._zod.run(payload, ctx);

      if (result instanceof Promise) {
        return result.then(async (r) => {
          if (r.issues.length > 0) return r;
          r.value = await def.transform(r.value);
          return r;
        });
      }

      if (result.issues.length > 0) return result;

      const transformed = def.transform(result.value);
      if (transformed instanceof Promise) {
        return transformed.then((t) => {
          result.value = t;
          return result;
        });
      }

      result.value = transformed;
      return result;
    };
  }
);

export function transform<T extends types.Schema, Out>(
  schema: T,
  transformer: (data: types.output<T>) => Out | Promise<Out>
): TransformSchema<T, Out> {
  return new TransformSchema({
    type: "transform",
    schema,
    transform: transformer,
  });
}

// Default wrapper - provides default value
export interface DefaultSchemaDef<T extends types.Schema> extends types.SchemaTypeDef {
  type: "default";
  schema: T;
  defaultValue: types.output<T> | (() => types.output<T>);
}

export interface DefaultSchema<T extends types.Schema>
  extends types.Schema<types.output<T>, types.input<T> | undefined> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T> } | { success: false; error: errors.SchemaError };
}

export const DefaultSchema: types.$constructor<DefaultSchema<any>, DefaultSchemaDef<any>> = types.$constructor(
  "DefaultSchema",
  (inst: DefaultSchema<any>, def: DefaultSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.optin = "optional"; // Mark as optional input

    inst._zod.parse = (payload, ctx) => {
      // If undefined, use default
      if (payload.value === undefined) {
        payload.value = typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
        return payload;
      }

      // Otherwise parse normally
      return def.schema._zod.run(payload, ctx);
    };
  }
);

export function _default<T extends types.Schema>(
  schema: T,
  defaultValue: types.output<T> | (() => types.output<T>)
): DefaultSchema<T> {
  return new DefaultSchema({
    type: "default",
    schema,
    defaultValue,
  });
}

// Catch wrapper - catches errors and returns fallback
export interface CatchSchemaDef<T extends types.Schema> extends types.SchemaTypeDef {
  type: "catch";
  schema: T;
  catchValue: types.output<T> | (() => types.output<T>);
}

export interface CatchSchema<T extends types.Schema>
  extends types.Schema<types.output<T>, types.input<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T> } | { success: false; error: errors.SchemaError };
}

export const CatchSchema: types.$constructor<CatchSchema<any>, CatchSchemaDef<any>> = types.$constructor("CatchSchema", (inst: CatchSchema<any>, def: CatchSchemaDef<any>) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, ctx) => {
    const result = def.schema._zod.run(payload, ctx);

    if (result instanceof Promise) {
      return result.then((r) => {
        if (r.issues.length > 0) {
          r.value = typeof def.catchValue === "function" ? def.catchValue() : def.catchValue;
          r.issues = [];
        }
        return r;
      });
    }

    if (result.issues.length > 0) {
      result.value = typeof def.catchValue === "function" ? def.catchValue() : def.catchValue;
      result.issues = [];
    }

    return result;
  };
});

export function _catch<T extends types.Schema>(
  schema: T,
  catchValue: types.output<T> | (() => types.output<T>)
): CatchSchema<T> {
  return new CatchSchema({
    type: "catch",
    schema,
    catchValue,
  });
}

// Optional wrapper - makes schema optional
export interface OptionalSchemaDef<T extends types.Schema> extends types.SchemaTypeDef {
  type: "optional";
  schema: T;
}

export interface OptionalSchemaInternals<T extends types.Schema>
  extends types.SchemaInternals<types.output<T> | undefined, types.input<T> | undefined> {
  def: OptionalSchemaDef<T>;
  optin: "optional";
  optout: "optional";
}

export interface OptionalSchema<T extends types.Schema>
  extends types.Schema<types.output<T> | undefined, types.input<T> | undefined, OptionalSchemaInternals<T>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T> | undefined;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T> | undefined } | { success: false; error: errors.SchemaError };
  unwrap(): T;
}

export const OptionalSchema: types.$constructor<OptionalSchema<any>, OptionalSchemaDef<any>> = types.$constructor(
  "OptionalSchema",
  (inst: OptionalSchema<any>, def: OptionalSchemaDef<any>) => {
    BaseSchema.init(inst, def);

    inst._zod.optin = "optional";
    inst._zod.optout = "optional";

    inst._zod.parse = (payload, ctx) => {
      // If the inner type is already optional, handle it specially
      if (def.schema._zod.optin === "optional") {
        const result = def.schema._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((r) => {
            if (r.issues.length > 0 && payload.value === undefined) {
              return { issues: [], value: undefined };
            }
            return r;
          });
        }
        if (result.issues.length > 0 && payload.value === undefined) {
          return { issues: [], value: undefined };
        }
        return result;
      }

      // If value is undefined, return success
      if (payload.value === undefined) {
        return payload;
      }

      // Otherwise parse normally
      return def.schema._zod.run(payload, ctx);
    };

    inst.unwrap = () => def.schema;
  }
);

export function optional<T extends types.Schema>(schema: T): OptionalSchema<T> {
  return new OptionalSchema({
    type: "optional",
    schema,
  });
}
