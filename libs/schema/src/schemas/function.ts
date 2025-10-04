import { BaseSchema } from "../core/base-schema";
import * as errors from "../core/errors";
import * as types from "../core/types";
import * as util from "../core/util";

// Function schema definition
export interface FunctionSchemaDef extends types.SchemaTypeDef {
  type: "function";
  input: readonly types.Schema[];
  output?: types.Schema;
}

// Extract parameter types from input schemas
type InferParams<T extends readonly types.Schema[]> = T extends readonly [infer First, ...infer Rest]
  ? First extends types.Schema
    ? Rest extends readonly types.Schema[]
      ? [types.output<First>, ...InferParams<Rest>]
      : [types.output<First>]
    : []
  : [];

// Infer function type for schema (s.infer)
type InferFunctionType<
  Input extends readonly types.Schema[],
  Output extends types.Schema | undefined
> = Output extends types.Schema
  ? (...args: InferParams<Input>) => types.output<Output>
  : (...args: InferParams<Input>) => void;

export interface FunctionSchemaInternals<
  Input extends readonly types.Schema[],
  Output extends types.Schema | undefined
> extends types.SchemaInternals<InferFunctionType<Input, Output>, InferFunctionType<Input, Output>> {
  def: FunctionSchemaDef;
}

export interface FunctionSchema<
  Input extends readonly types.Schema[],
  Output extends types.Schema | undefined
> extends types.Schema<
    InferFunctionType<Input, Output>,
    InferFunctionType<Input, Output>,
    FunctionSchemaInternals<Input, Output>
  > {
  implement<F extends (...args: InferParams<Input>) => any>(fn: F): F;
  meta(metadata: Record<string, any>): this;
  parse(data: unknown, params?: types.ParseContext): InferFunctionType<Input, Output>;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ):
    | { success: true; data: InferFunctionType<Input, Output> }
    | { success: false; error: errors.SchemaError };
}

export const FunctionSchema = types.$constructor<FunctionSchema<any, any>>(
  "FunctionSchema",
  (inst, def: FunctionSchemaDef) => {
    BaseSchema.init(inst, def);

    inst._zod.parse = (payload, _ctx) => {
      if (typeof payload.value !== "function") {
        payload.issues.push({
          code: "invalid_type",
          expected: "function",
          input: payload.value,
          inst,
        });
      }
      return payload;
    };

    inst.implement = (fn: any) => {
      const inputSchemas = def.input;
      const outputSchema = def.output;

      // Create wrapped function that validates input and output
      const wrappedFn = (...args: any[]) => {
        // Validate input arguments
        if (args.length !== inputSchemas.length) {
          throw new errors.SchemaError([
            {
              code: "invalid_arguments",
              expected: `${inputSchemas.length} arguments`,
              message: `Expected ${inputSchemas.length} arguments, got ${args.length}`,
            },
          ]);
        }

        const validatedArgs: any[] = [];
        for (let i = 0; i < inputSchemas.length; i++) {
          const schema = inputSchemas[i];
          const arg = args[i];
          const result = schema._zod.run({ value: arg, issues: [] }, { async: false });

          if (result instanceof Promise) {
            throw new types.AsyncError();
          }

          if (result.issues.length > 0) {
            throw new errors.SchemaError(result.issues);
          }

          validatedArgs.push(result.value);
        }

        // Call the function
        const fnResult = fn(...validatedArgs);

        // If output schema is defined, validate the result
        if (outputSchema) {
          // Handle async functions
          if (fnResult instanceof Promise) {
            return fnResult.then((value) => {
              const outputResult = outputSchema._zod.run({ value, issues: [] }, { async: false });

              if (outputResult instanceof Promise) {
                return outputResult.then((r) => {
                  if (r.issues.length > 0) {
                    throw new errors.SchemaError(r.issues);
                  }
                  return r.value;
                });
              }

              if (outputResult.issues.length > 0) {
                throw new errors.SchemaError(outputResult.issues);
              }

              return outputResult.value;
            });
          }

          // Handle sync functions
          const outputResult = outputSchema._zod.run({ value: fnResult, issues: [] }, { async: false });

          if (outputResult instanceof Promise) {
            throw new types.AsyncError();
          }

          if (outputResult.issues.length > 0) {
            throw new errors.SchemaError(outputResult.issues);
          }

          return outputResult.value;
        }

        // No output schema - return the raw function result
        return fnResult;
      };

      return wrappedFn as any;
    };
  }
);

export function _function<const Input extends readonly types.Schema[], Output extends types.Schema | undefined = undefined>(config: {
  input: Input;
  output?: Output;
}): FunctionSchema<Input, Output> {
  return new FunctionSchema({
    type: "function",
    input: config.input,
    output: config.output,
  });
}
