import { describe, it, expect } from "vitest";
import { s } from "../index";

describe("function schema", () => {
  it("validates function type", () => {
    const fnSchema = s.function({
      input: [s.string()],
      output: s.number(),
    });

    expect(fnSchema.safeParse(() => {}).success).toBe(true);
    expect(fnSchema.safeParse("not a function").success).toBe(false);
    expect(fnSchema.safeParse(123).success).toBe(false);
  });

  it("implements sync function with input validation", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement((input) => {
      return input.trim().length;
    });

    expect(fn("hello")).toBe(5);
    expect(fn("  world  ")).toBe(5);
    expect(() => fn(123 as any)).toThrow();
  });

  it("implements sync function with output validation", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement((input) => {
      return input as any; // Wrong output type
    });

    expect(() => fn("hello")).toThrow();
  });

  it("implements function with multiple inputs", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number(), s.boolean()],
      output: s.string(),
    });

    const fn = MyFunction.implement((str, num, bool) => {
      return `${str}-${num}-${bool}`;
    });

    expect(fn("test", 42, true)).toBe("test-42-true");
    expect(() => fn("test", "wrong" as any, true)).toThrow();
  });

  it("implements function without output schema", () => {
    const MyFunction = s.function({
      input: [s.string()],
    });

    const fn = MyFunction.implement((input) => {
      // No return validation
      return input.toUpperCase();
    });

    expect(fn("hello")).toBe("HELLO");
  });

  it("implements async function with input validation", async () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return input.trim().length;
    });

    expect(await fn("hello")).toBe(5);
    expect(await fn("  world  ")).toBe(5);
    // Input validation happens synchronously, so it throws
    expect(() => fn(123 as any)).toThrow();
  });

  it("implements async function with output validation", async () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return input as any; // Wrong output type
    });

    await expect(fn("hello")).rejects.toThrow();
  });

  it("validates argument count", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number()],
      output: s.string(),
    });

    const fn = MyFunction.implement((str, num) => {
      return `${str}-${num}`;
    });

    expect(() => (fn as any)("only one")).toThrow();
    expect(() => (fn as any)()).toThrow();
  });

  it("transforms input values", () => {
    const MyFunction = s.function({
      input: [s.string().trim()],
      output: s.number(),
    });

    const fn = MyFunction.implement((input) => {
      // Input should already be trimmed
      return input.length;
    });

    expect(fn("  hello  ")).toBe(5); // Trimmed by schema
  });

  it("transforms output values", () => {
    const MyFunction = s.function({
      input: [s.number()],
      output: s.string().trim(),
    });

    const fn = MyFunction.implement((num) => {
      return `  ${num}  `; // Will be trimmed by output schema
    });

    expect(fn(42)).toBe("42");
  });

  it("handles complex object inputs", () => {
    const MyFunction = s.function({
      input: [
        s.object({
          name: s.string(),
          age: s.number(),
        }),
      ],
      output: s.string(),
    });

    const fn = MyFunction.implement((user) => {
      return `${user.name} is ${user.age}`;
    });

    expect(fn({ name: "Alice", age: 30 })).toBe("Alice is 30");
    expect(() => fn({ name: "Bob" } as any)).toThrow();
  });

  it("handles array inputs", () => {
    const MyFunction = s.function({
      input: [s.array(s.number())],
      output: s.number(),
    });

    const fn = MyFunction.implement((nums) => {
      return nums.reduce((a, b) => a + b, 0);
    });

    expect(fn([1, 2, 3, 4])).toBe(10);
    expect(() => fn([1, "2", 3] as any)).toThrow();
  });

  it("handles optional parameters", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number().optional()],
      output: s.string(),
    });

    const fn = MyFunction.implement((str, num) => {
      return num !== undefined ? `${str}-${num}` : str;
    });

    expect(fn("test", 42)).toBe("test-42");
    expect(fn("test", undefined)).toBe("test");
  });

  it("handles nested async operations", async () => {
    const fetchUser = s.function({
      input: [s.string()],
      output: s.object({
        id: s.string(),
        name: s.string(),
      }),
    });

    const fn = fetchUser.implement(async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        id,
        name: "Test User",
      };
    });

    const result = await fn("123");
    expect(result).toMatchObject({ id: "123", name: "Test User" });
  });

  it("validates return type for async functions returning sync values", async () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement(async (input) => {
      // Async function but synchronous return validation still applies
      return input.length;
    });

    expect(await fn("hello")).toBe(5);
  });
});
