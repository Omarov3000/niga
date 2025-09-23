import { z } from "zod";

export function getDefaultValueFromZodSchema(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const result: any = {};
    for (const [key, value] of Object.entries(schema.shape)) {
      result[key] = getDefaultValueFromZodSchema(value);
    }
    return result;
  }

  if (schema instanceof z.ZodArray) {
    return [];
  }

  if (schema instanceof z.ZodString) {
    return "";
  }

  if (schema instanceof z.ZodNumber) {
    return 0;
  }

  if (schema instanceof z.ZodBoolean) {
    return false;
  }

  if (schema instanceof z.ZodEnum) {
    return schema.options[0];
  }

  if (schema instanceof z.ZodLiteral) {
    return schema.value;
  }

  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue;
  }

  if (schema instanceof z.ZodUnion) {
    return getDefaultValueFromZodSchema(schema.options[0] as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodOptional) {
    return undefined;
  }

  if (schema instanceof z.ZodNullable) {
    return null;
  }

  return undefined;
}
