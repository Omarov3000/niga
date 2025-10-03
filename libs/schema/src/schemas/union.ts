import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";

// Union schema definition
export interface UnionSchemaDef<T extends readonly [types.Schema, types.Schema, ...types.Schema[]]>
  extends types.SchemaTypeDef {
  type: "union";
  options: T;
}

export interface UnionSchemaInternals<T extends readonly [types.Schema, types.Schema, ...types.Schema[]]>
  extends types.SchemaInternals<types.output<T[number]>, types.input<T[number]>> {
  def: UnionSchemaDef<T>;
}

export interface UnionSchema<T extends readonly [types.Schema, types.Schema, ...types.Schema[]]>
  extends types.Schema<types.output<T[number]>, types.input<T[number]>, UnionSchemaInternals<T>> {
  readonly options: T;
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T[number]>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T[number]> } | { success: false; error: errors.SchemaError };
}

export const UnionSchema = types.$constructor<UnionSchema<any>>("UnionSchema", (inst, def: UnionSchemaDef<any>) => {
  BaseSchema.init(inst, def);

  inst._zod.parse = (payload, ctx) => {
    const allIssues: errors.RawIssue[][] = [];

    // Try each option
    for (const option of def.options) {
      const optionPayload = option._zod.run({ value: payload.value, issues: [] }, ctx);

      if (optionPayload instanceof Promise) {
        // Handle async case - return first successful parse
        return optionPayload.then((p) => {
          if (p.issues.length === 0) {
            payload.value = p.value;
            return payload;
          }
          allIssues.push(p.issues);

          // Continue trying other options
          return tryRemainingOptions(def.options.indexOf(option) + 1);
        });
      } else {
        if (optionPayload.issues.length === 0) {
          payload.value = optionPayload.value;
          return payload;
        }
        allIssues.push(optionPayload.issues);
      }
    }

    // Helper for async continuation
    function tryRemainingOptions(startIndex: number): types.ParsePayload | Promise<types.ParsePayload> {
      for (let i = startIndex; i < def.options.length; i++) {
        const option = def.options[i];
        const optionPayload = option._zod.run({ value: payload.value, issues: [] }, ctx);

        if (optionPayload instanceof Promise) {
          return optionPayload.then((p) => {
            if (p.issues.length === 0) {
              payload.value = p.value;
              return payload;
            }
            allIssues.push(p.issues);
            return tryRemainingOptions(i + 1);
          });
        } else {
          if (optionPayload.issues.length === 0) {
            payload.value = optionPayload.value;
            return payload;
          }
          allIssues.push(optionPayload.issues);
        }
      }

      // All options failed
      payload.issues.push({
        code: "invalid_type",
        expected: "union",
        input: payload.value,
        inst,
        message: `Invalid input: tried ${allIssues.length} union options`,
      });
      return payload;
    }

    // All options failed
    payload.issues.push({
      code: "invalid_type",
      expected: "union",
      input: payload.value,
      inst,
      message: `Invalid input: tried ${allIssues.length} union options`,
    });
    return payload;
  };

  Object.defineProperty(inst, "options", {
    value: def.options,
    enumerable: true,
  });
});

export function union<T extends readonly [types.Schema, types.Schema, ...types.Schema[]]>(options: T): UnionSchema<T> {
  return new UnionSchema({
    type: "union",
    options,
  });
}

// Discriminated union schema
export interface DiscriminatedUnionSchemaDef<
  K extends string,
  T extends readonly [types.Schema, types.Schema, ...types.Schema[]],
> extends types.SchemaTypeDef {
  type: "discriminated_union";
  discriminator: K;
  options: T;
}

export interface DiscriminatedUnionSchema<
  K extends string,
  T extends readonly [types.Schema, types.Schema, ...types.Schema[]],
> extends types.Schema<types.output<T[number]>, types.input<T[number]>> {
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<T[number]>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<T[number]> } | { success: false; error: errors.SchemaError };
}

export const DiscriminatedUnionSchema: types.$constructor<DiscriminatedUnionSchema<any, any>, DiscriminatedUnionSchemaDef<any, any>> = types.$constructor(
  "DiscriminatedUnionSchema",
  (inst: DiscriminatedUnionSchema<any, any>, def: DiscriminatedUnionSchemaDef<any, any>) => {
    BaseSchema.init(inst, def);

    // Build discriminator map
    const discriminatorMap = new Map<any, types.Schema>();
    for (const option of def.options) {
      // Assume option is an object schema with the discriminator key
      if (option._zod.def.type === "object" && option._zod.def.shape[def.discriminator]) {
        const discriminatorSchema = option._zod.def.shape[def.discriminator];
        // If it's a literal, use its value
        if (discriminatorSchema._zod.def.type === "literal") {
          discriminatorMap.set(discriminatorSchema._zod.def.value, option);
        }
      }
    }

    inst._zod.parse = (payload, ctx) => {
      if (typeof payload.value !== "object" || payload.value === null) {
        payload.issues.push({
          code: "invalid_type",
          expected: "object",
          input: payload.value,
          inst,
        });
        return payload;
      }

      const discriminatorValue = (payload.value as any)[def.discriminator];
      const option = discriminatorMap.get(discriminatorValue);

      if (!option) {
        payload.issues.push({
          code: "invalid_type",
          expected: "discriminated_union",
          input: payload.value,
          inst,
          message: `Invalid discriminator value: ${JSON.stringify(discriminatorValue)}`,
        });
        return payload;
      }

      return option._zod.run(payload, ctx);
    };
  }
);

export function discriminatedUnion<
  K extends string,
  T extends readonly [types.Schema, types.Schema, ...types.Schema[]],
>(discriminator: K, options: T): DiscriminatedUnionSchema<K, T> {
  return new DiscriminatedUnionSchema({
    type: "discriminated_union",
    discriminator,
    options,
  });
}
