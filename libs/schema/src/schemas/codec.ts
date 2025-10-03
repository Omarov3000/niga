import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Codec schema definition
export interface CodecSchemaDef<A extends types.SomeSchema, B extends types.SomeSchema> extends types.SchemaTypeDef {
  type: "codec";
  input: A;
  output: B;
  decode: (value: types.output<A>, payload: types.ParsePayload<types.output<A>>) => util.MaybeAsync<types.input<B>>;
  encode: (value: types.input<B>, payload: types.ParsePayload<types.input<B>>) => util.MaybeAsync<types.output<A>>;
}

export interface CodecSchemaInternals<A extends types.SomeSchema, B extends types.SomeSchema> extends types.SchemaInternals<types.output<B>, types.input<A>> {
  def: CodecSchemaDef<A, B>;
  bag: Record<string, unknown>;
}

export interface CodecSchema<A extends types.SomeSchema = types.SomeSchema, B extends types.SomeSchema = types.SomeSchema> extends types.Schema<types.output<B>, types.input<A>, CodecSchemaInternals<A, B>> {
  input: A;
  output: B;
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): types.output<B>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: types.output<B> } | { success: false; error: errors.SchemaError };
}

export const CodecSchema = types.$constructor<CodecSchema>("CodecSchema", (inst, def: CodecSchemaDef<any, any>) => {
  BaseSchema.init(inst, def);

  inst.input = def.input;
  inst.output = def.output;

  // Override the parse function to implement codec behavior
  const inputRun = def.input._zod.run;
  const outputRun = def.output._zod.run;

  inst._zod.parse = (payload, ctx) => {
    // First, validate with input schema
    const inputResult = inputRun({ ...payload }, ctx);

    if (inputResult instanceof Promise) {
      if (ctx.async === false) throw new types.AsyncError();
      return inputResult.then((inputPayload) => {
        if (util.aborted(inputPayload)) return inputPayload;

        // Then, run the decode transform
        const decodeResult = def.decode(inputPayload.value, inputPayload);
        if (decodeResult instanceof Promise) {
          return decodeResult.then((decodedValue) => {
            // Finally, validate with output schema
            return outputRun({ value: decodedValue, issues: inputPayload.issues }, ctx);
          });
        }

        // Finally, validate with output schema
        return outputRun({ value: decodeResult, issues: inputPayload.issues }, ctx);
      });
    }

    if (util.aborted(inputResult)) return inputResult;

    // Then, run the decode transform
    const decodeResult = def.decode(inputResult.value, inputResult);
    if (decodeResult instanceof Promise) {
      if (ctx.async === false) throw new types.AsyncError();
      return decodeResult.then((decodedValue) => {
        // Finally, validate with output schema
        return outputRun({ value: decodedValue, issues: inputResult.issues }, ctx);
      });
    }

    // Finally, validate with output schema
    return outputRun({ value: decodeResult, issues: inputResult.issues }, ctx);
  };
});

export function codec<const A extends types.SomeSchema, B extends types.SomeSchema>(
  input: A,
  output: B,
  transforms: {
    decode: (value: types.output<A>, payload: types.ParsePayload<types.output<A>>) => util.MaybeAsync<types.input<B>>;
    encode: (value: types.input<B>, payload: types.ParsePayload<types.input<B>>) => util.MaybeAsync<types.output<A>>;
  }
): CodecSchema<A, B> {
  return new CodecSchema({
    type: "codec",
    input,
    output,
    decode: transforms.decode as any,
    encode: transforms.encode as any,
  }) as CodecSchema<A, B>;
}

// Decode utility function (forward transform)
export function decode<A extends types.SomeSchema, B extends types.SomeSchema>(
  schema: CodecSchema<A, B>,
  data: types.output<A>
): types.output<B> {
  if (!("_zod" in schema && schema._zod.def.type === "codec")) {
    throw new Error("decode() can only be used with codec schemas");
  }

  const result = schema.parse(data);
  return result;
}

// Safe decode utility function
export function safeDecode<A extends types.SomeSchema, B extends types.SomeSchema>(
  schema: CodecSchema<A, B>,
  data: types.output<A>
): { success: true; data: types.output<B> } | { success: false; error: errors.SchemaError } {
  if (!("_zod" in schema && schema._zod.def.type === "codec")) {
    throw new Error("safeDecode() can only be used with codec schemas");
  }

  return schema.safeParse(data);
}

// Encode utility function (reverse transform)
export function encode<A extends types.SomeSchema, B extends types.SomeSchema>(
  schema: CodecSchema<A, B>,
  data: any
): any {
  if (!("_zod" in schema && schema._zod.def.type === "codec")) {
    throw new Error("encode() can only be used with codec schemas");
  }

  const def = schema._zod.def as CodecSchemaDef<A, B>;
  const ctx: types.ParseContext = { async: false };

  // First, validate with output schema (in reverse)
  const outputResult = def.output._zod.run({ value: data, issues: [] }, ctx);

  if (outputResult instanceof Promise) {
    throw new types.AsyncError();
  }

  if (outputResult.issues.length > 0) {
    throw new errors.SchemaError(outputResult.issues);
  }

  // Then, run the encode transform
  const encodeResult = def.encode(outputResult.value as any, outputResult as any);

  if (encodeResult instanceof Promise) {
    throw new types.AsyncError();
  }

  // Finally, validate with input schema
  const inputResult = def.input._zod.run({ value: encodeResult, issues: [] }, ctx);

  if (inputResult instanceof Promise) {
    throw new types.AsyncError();
  }

  if (inputResult.issues.length > 0) {
    throw new errors.SchemaError(inputResult.issues);
  }

  return inputResult.value;
}

// Safe encode utility function
export function safeEncode<A extends types.SomeSchema, B extends types.SomeSchema>(
  schema: CodecSchema<A, B>,
  data: types.input<B>
): { success: true; data: types.output<A> } | { success: false; error: errors.SchemaError } {
  try {
    const result = encode(schema, data);
    return { success: true as const, data: result };
  } catch (error) {
    if (error instanceof errors.SchemaError) {
      return { success: false as const, error };
    }
    throw error;
  }
}
