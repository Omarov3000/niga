declare module "cloudflare:test" {
  // ProvidedEnv controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Env {
    testD1: D1Database
  }
}

// For query-fe compatibility
declare const window: any;
