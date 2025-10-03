import { describe, it, expectTypeOf } from "vitest";
import { s } from "../index";

describe("function schema types", () => {
  it("infers correct function type", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<(input: string) => number>();
  });

  it("infers function with multiple parameters", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number(), s.boolean()],
      output: s.string(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<(arg0: string, arg1: number, arg2: boolean) => string>();
  });

  it("infers function without output", () => {
    const MyFunction = s.function({
      input: [s.string()],
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<(input: string) => void>();
  });

  it("infers function with complex input types", () => {
    const MyFunction = s.function({
      input: [
        s.object({
          name: s.string(),
          age: s.number(),
        }),
        s.array(s.string()),
      ],
      output: s.boolean(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<
      (arg0: { name: string; age: number }, arg1: string[]) => boolean
    >();
  });

  it("implement method accepts sync function", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    const fn = MyFunction.implement((input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
      return 42;
    });

    expectTypeOf(fn).toEqualTypeOf<(input: string) => number>();
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

  it("implement method with multiple parameters", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number(), s.boolean()],
      output: s.string(),
    });

    const fn = MyFunction.implement((str, num, bool) => {
      expectTypeOf(str).toEqualTypeOf<string>();
      expectTypeOf(num).toEqualTypeOf<number>();
      expectTypeOf(bool).toEqualTypeOf<boolean>();
      return "result";
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: string, arg1: number, arg2: boolean) => string>();
  });

  it("implement method without output schema", () => {
    const MyFunction = s.function({
      input: [s.string()],
    });

    const fn = MyFunction.implement((input) => {
      expectTypeOf(input).toEqualTypeOf<string>();
      return "anything"; // Return type not validated
    });

    expectTypeOf(fn).toEqualTypeOf<(input: string) => void>();
  });

  it("implement with complex object types", () => {
    const User = s.object({
      id: s.string(),
      name: s.string(),
      email: s.string(),
    });

    const MyFunction = s.function({
      input: [User],
      output: s.string(),
    });

    const fn = MyFunction.implement((user) => {
      expectTypeOf(user).toEqualTypeOf<{ id: string; name: string; email: string }>();
      return user.name;
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: { id: string; name: string; email: string }) => string>();
  });

  it("implement with optional parameters", () => {
    const MyFunction = s.function({
      input: [s.string(), s.number().optional()],
      output: s.string(),
    });

    const fn = MyFunction.implement((str, num) => {
      expectTypeOf(str).toEqualTypeOf<string>();
      expectTypeOf(num).toEqualTypeOf<number | undefined>();
      return str;
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: string, arg1: number | undefined) => string>();
  });

  it("implement with array parameters", () => {
    const MyFunction = s.function({
      input: [s.array(s.number())],
      output: s.number(),
    });

    const fn = MyFunction.implement((nums) => {
      expectTypeOf(nums).toEqualTypeOf<number[]>();
      return nums[0];
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: number[]) => number>();
  });

  it("implement with union types", () => {
    const MyFunction = s.function({
      input: [s.union([s.string(), s.number()])],
      output: s.string(),
    });

    const fn = MyFunction.implement((input) => {
      expectTypeOf(input).toEqualTypeOf<string | number>();
      return String(input);
    });

    expectTypeOf(fn).toEqualTypeOf<(arg0: string | number) => string>();
  });

  it("schema type is correctly exported", () => {
    const MyFunction = s.function({
      input: [s.string()],
      output: s.number(),
    });

    expectTypeOf<typeof MyFunction>().toMatchTypeOf<s.FunctionSchema<[s.StringSchema], s.NumberSchema>>();
  });

  it("infers empty parameter list", () => {
    const MyFunction = s.function({
      input: [],
      output: s.string(),
    });

    type MyFunction = s.infer<typeof MyFunction>;
    expectTypeOf<MyFunction>().toEqualTypeOf<() => string>();
  });

  it("implement with no parameters", () => {
    const MyFunction = s.function({
      input: [],
      output: s.string(),
    });

    const fn = MyFunction.implement(() => {
      return "hello";
    });

    expectTypeOf(fn).toEqualTypeOf<() => string>();
  });
});
