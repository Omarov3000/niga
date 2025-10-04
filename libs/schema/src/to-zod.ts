import { z } from "zod";
import type { Schema } from "./core/types";
import type {
  StringSchema,
  NumberSchema,
  BooleanSchema,
  NullSchema,
  UndefinedSchema,
  UnknownSchema,
  DateSchema,
  LiteralSchema,
  EnumSchema,
  ArraySchema,
  ObjectSchema,
  RecordSchema,
  InstanceOfSchema,
  CustomSchema,
  OptionalSchema,
} from "./index";

// Zod's Literal type (excluding symbol)
type ZodLiteral = string | number | boolean | bigint | null | undefined;

// Depth counter for recursion limit
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Type mapping from schema to Zod with depth limit
type ToZod<T, D extends number = 10> = [D] extends [never] ? z.ZodTypeAny :
  T extends OptionalSchema<infer Inner> ? z.ZodOptional<ToZod<Inner, Prev[D]>> :
  T extends DateSchema ? z.ZodDate :
  T extends LiteralSchema<infer L> ? (L extends ZodLiteral ? z.ZodLiteral<L> : z.ZodTypeAny) :
  T extends EnumSchema<infer E> ? z.ZodType<E[number]> :
  T extends ArraySchema<infer El> ? z.ZodArray<ToZod<El, Prev[D]>> :
  T extends ObjectSchema<infer Shape> ? z.ZodObject<{ [K in keyof Shape]: ToZod<Shape[K], Prev[D]> }> :
  T extends RecordSchema<infer K, infer V> ?
    (K extends StringSchema ? z.ZodRecord<z.ZodString, ToZod<V, Prev[D]>> :
     K extends NumberSchema ? z.ZodRecord<z.ZodNumber, ToZod<V, Prev[D]>> :
     z.ZodRecord<z.ZodString, ToZod<V, Prev[D]>>) :
  T extends InstanceOfSchema<infer C> ? z.ZodType<InstanceType<C>> :
  T extends CustomSchema<infer CT> ? z.ZodType<CT> :
  T extends StringSchema ? z.ZodString :
  T extends NumberSchema ? z.ZodNumber :
  T extends BooleanSchema ? z.ZodBoolean :
  T extends NullSchema ? z.ZodNull :
  T extends UndefinedSchema ? z.ZodUndefined :
  T extends UnknownSchema ? z.ZodUnknown :
  z.ZodTypeAny;

/**
 * Converts a schema to a Zod schema (structural conversion only)
 * Note: This only converts the structure, not validation rules
 */
export function toZod<T extends Schema>(schema: T): ToZod<T>;
export function toZod(schema: Schema): z.ZodTypeAny {
  const def = schema._zod.def;

  switch (def.type) {
    case "string":
      return z.string();

    case "number":
      return z.number();

    case "boolean":
      return z.boolean();

    case "null":
      return z.null();

    case "undefined":
      return z.undefined();

    case "unknown":
      return z.unknown();

    case "date":
      return z.date();

    case "literal":
      return z.literal(def.value);

    case "enum":
      return z.enum(def.values);

    case "array":
      return z.array(toZod(def.element));

    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const key in def.shape) {
        const propSchema = def.shape[key];
        let zodSchema = toZod(propSchema);

        // Handle optional properties
        if (propSchema._zod.optout === "optional") {
          zodSchema = zodSchema.optional();
        }

        shape[key] = zodSchema;
      }
      return z.object(shape);
    }

    case "record": {
      const valueZod = toZod(def.valueSchema);

      // Check if key is string or number at runtime
      const keyType = def.keySchema._zod.def.type;
      if (keyType === "string") {
        return z.record(z.string(), valueZod);
      } else if (keyType === "number") {
        return z.record(z.number(), valueZod);
      }
      // Fallback to string key
      return z.record(z.string(), valueZod);
    }

    case "instanceof":
      return z.instanceof(def.class);

    case "custom":
      return z.custom(def.validate);

    default:
      // For unsupported types, return z.unknown()
      return z.unknown();
  }
}
