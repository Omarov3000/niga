// Type utilities for optimal TypeScript performance

export type AssertEqual<T, U> = (<V>() => V extends T ? 1 : 2) extends <V>() => V extends U ? 1 : 2 ? true : false;
export type IsAny<T> = 0 extends 1 & T ? true : false;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type NoUndefined<T> = T extends undefined ? never : T;

export type LoosePartial<T extends object> = InexactPartial<T> & {
  [k: string]: unknown;
};

export type InexactPartial<T> = {
  [P in keyof T]?: T[P] | undefined;
};

export type Writeable<T> = { -readonly [P in keyof T]: T[P] } & {};

// Force TypeScript to compute and cache the type
export type Identity<T> = T;
export type Flatten<T> = Identity<{ [k in keyof T]: T[k] }>;
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Literal = string | number | boolean | bigint | symbol | null | undefined;

export type MaybeAsync<T> = T | Promise<T>;

export type AnyFunc = (...args: any[]) => any;

export type SomeObject = Record<PropertyKey, any>;

// Fast path for extending objects
export type Extend<A extends SomeObject, B extends SomeObject> = Flatten<
  keyof A & keyof B extends never
    ? A & B
    : {
        [K in keyof A as K extends keyof B ? never : K]: A[K];
      } & {
        [K in keyof B]: B[K];
      }
>;

// Utility for normalizing parameters (string | object)
export function normalizeParams<T extends { error?: any }>(
  params?: string | T
): T | { error: string } | undefined {
  if (typeof params === "string") {
    return { error: params } as any;
  }
  return params;
}

// Merge definition objects
export function mergeDefs<T extends object>(base: T, override: Partial<T>): T {
  return { ...base, ...override };
}

// Check if payload is aborted
export function aborted(payload: { issues: any[] }, fromIndex = 0): boolean {
  for (let i = fromIndex; i < payload.issues.length; i++) {
    if (payload.issues[i].continue === false) return true;
  }
  return false;
}

// Prefix issues with path segment
export function prefixIssues(key: PropertyKey, issues: any[]): any[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path ? [key, ...issue.path] : [key],
  }));
}

// JSON stringify replacer for special types
export function jsonStringifyReplacer(_key: string, value: any): any {
  if (typeof value === "bigint") {
    return value.toString() + "n";
  }
  return value;
}

// Clone a schema instance
export function clone<T extends { _zod: any }>(
  inst: T,
  def?: Partial<T["_zod"]["def"]>,
  _params?: { parent: boolean }
): T {
  const Constructor = inst._zod.constr;
  return new Constructor(def ? { ...inst._zod.def, ...def } : inst._zod.def);
}
