import type * as util from "./util";

// Trait system for schema instances
type ZodTrait = { _zod: { def: any; [k: string]: any } };

export interface $constructor<T extends ZodTrait, D = T["_zod"]["def"]> {
  new (def: D): T;
  init(inst: T, def: D): asserts inst is T;
}

// Create a constructor function with trait support
export function $constructor<T extends ZodTrait, D extends T["_zod"]["def"] = T["_zod"]["def"]>(
  name: string,
  initializer: (inst: T, def: D) => void
): $constructor<T, D> {
  function init(inst: T, def: D) {
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false,
      writable: true,
      configurable: true,
    });

    inst._zod.traits ??= new Set();
    inst._zod.traits.add(name);
    initializer(inst, def);

    // Support prototype modifications
    for (const k in _.prototype) {
      if (!(k in inst)) {
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
      }
    }

    inst._zod.constr = _;
    inst._zod.def = def;
  }

  function _(this: any, def: D) {
    const inst = this ?? {};
    init(inst, def);

    // Execute deferred initializers
    inst._zod.deferred ??= [];
    for (const fn of inst._zod.deferred) {
      fn();
    }

    return inst;
  }

  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst: any) => inst?._zod?.traits?.has(name),
  });
  Object.defineProperty(_, "name", { value: name });

  return _ as any;
}

export const NEVER: never = Object.freeze({ status: "aborted" }) as never;

export class AsyncError extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}
