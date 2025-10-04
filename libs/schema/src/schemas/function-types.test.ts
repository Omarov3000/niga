import { describe, it, expectTypeOf } from "vitest";
import { s } from "../index";

describe("function schema types", () => {
  it("infers function with multiple parameters", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number(), s.boolean()],
      output: s.string(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<(arg0: string, arg1: number, arg2: boolean) => string>();

    const fn = MyFunction.implement((str, num, bool) => {
      expectTypeOf(str).toEqualTypeOf<string>();
      expectTypeOf(num).toEqualTypeOf<number>();
      expectTypeOf(bool).toEqualTypeOf<boolean>();
      return "result";
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: string, arg1: number, arg2: boolean) => string>();
  });

  it("infers function without output", () => {
    const MyFunction = s.function({
      input: [s.string()],
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<(input: string) => void>();

    const fn = MyFunction.implement((input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
    });

    expectTypeOf(fn).toEqualTypeOf<(input: string) => void>();

    const fn2 = MyFunction.implement((input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
      return "anything";
    });

    expectTypeOf(fn2).toEqualTypeOf<(input: string) => void>(); // wrong return type
  });

  it("implement method accepts async function", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement(async (input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
      return 42;
    });

    expectTypeOf(fn).toEqualTypeOf<(input: string) => Promise<number>>();
  });

  it("implement method without output schema", () => {
    const MyFunction = s.function({
      input: [s.string()],
    });

    const fn = MyFunction.implement(async (input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
      return "anything";
    });

    expectTypeOf(fn).toEqualTypeOf<(input: string) => void>(); // wrong return type
  });

  it("infers empty parameter list", () => {
    const MyFunction = s.function({
      input: [],
      output: s.string(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<() => string>();

     const fn = MyFunction.implement(() => {
      return "hello";
    });

    expectTypeOf(fn).toEqualTypeOf<() => string>();
  });
});
