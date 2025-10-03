import * as errors from "./errors";
import * as types from "./types";
import * as util from "./util";

// Base schema implementation
export interface BaseSchema<O = unknown, I = unknown> extends types.Schema<O, I> {
  parse(data: unknown, params?: types.ParseContext): O;
  safeParse(
    data: unknown,
    params?: types.ParseContext
  ): { success: true; data: O } | { success: false; error: errors.SchemaError };
}

export const BaseSchema: types.$constructor<BaseSchema, types.SchemaTypeDef> = types.$constructor<BaseSchema>("BaseSchema", (inst, def: types.SchemaTypeDef) => {
  inst._zod = inst._zod ?? ({} as any);
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.traits ??= new Set();

  const checks = [...(def.checks ?? [])];

  // Run checks on payload
  const runChecks = (
    payload: types.ParsePayload,
    checks: types.Check[],
    ctx: types.ParseContext
  ): util.MaybeAsync<types.ParsePayload> => {
    let isAborted = util.aborted(payload);
    let asyncResult: Promise<unknown> | undefined;

    for (const ch of checks) {
      if (isAborted) continue;

      const currLen = payload.issues.length;
      const result = ch._zod.check(payload);

      if (result instanceof Promise) {
        if (ctx.async === false) throw new types.AsyncError();
        asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
          await result;
          const nextLen = payload.issues.length;
          if (nextLen === currLen) return;
          if (!isAborted) isAborted = util.aborted(payload, currLen);
        });
      } else {
        const nextLen = payload.issues.length;
        if (nextLen === currLen) continue;
        if (!isAborted) isAborted = util.aborted(payload, currLen);
      }
    }

    if (asyncResult) {
      return asyncResult.then(() => payload);
    }
    return payload;
  };

  if (checks.length === 0) {
    inst._zod.deferred ??= [];
    inst._zod.deferred.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    // Attach check hooks
    for (const ch of checks) {
      for (const fn of ch._zod.onattach) {
        fn(inst);
      }
    }

    inst._zod.run = (payload, ctx) => {
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false) throw new types.AsyncError();
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }

  // Standard schema implementation
  inst["~standard"] = {
    validate: (value: unknown) => {
      try {
        const result = inst.safeParse(value);
        if (result.success) {
          return { value: result.data };
        }
        return { issues: result.error.issues };
      } catch (_) {
        const asyncResult = inst.safeParse(value, { async: true }) as any;
        if (asyncResult && typeof asyncResult === "object" && "then" in asyncResult) {
          return asyncResult.then((r: any) =>
            r.success ? { value: r.data } : { issues: r.error.issues }
          );
        }
        return asyncResult;
      }
    },
    vendor: "w/schema",
    version: 1 as const,
  };

  // Public API methods
  inst.parse = (data, params) => {
    const ctx: types.ParseContext = { async: false, ...params };
    const errorMap =
      params?.error ||
      (typeof def.error === "function" && def.error.length === 2 ? def.error as errors.ErrorMap : undefined);

    const payload = inst._zod.run({ value: data, issues: [] }, ctx);

    if (payload instanceof Promise) {
      throw new types.AsyncError();
    }

    if (payload.issues.length > 0) {
      throw new errors.SchemaError(payload.issues, errorMap);
    }

    return payload.value;
  };

  inst.safeParse = (data, params) => {
    const ctx: types.ParseContext = { async: false, ...params };
    const errorMap =
      params?.error ||
      (typeof def.error === "function" && def.error.length === 2 ? def.error as errors.ErrorMap : undefined);

    try {
      const payload = inst._zod.run({ value: data, issues: [] }, ctx);

      if (payload instanceof Promise) {
        return payload.then((p) => {
          if (p.issues.length > 0) {
            return { success: false as const, error: new errors.SchemaError(p.issues, errorMap) };
          }
          return { success: true as const, data: p.value };
        }) as any;
      }

      if (payload.issues.length > 0) {
        return { success: false as const, error: new errors.SchemaError(payload.issues, errorMap) };
      }

      return { success: true as const, data: payload.value };
    } catch (error) {
      if (error instanceof types.AsyncError) {
        throw error;
      }
      return {
        success: false as const,
        error: new errors.SchemaError([{ code: "custom", message: String(error) }], errorMap),
      };
    }
  };
});
