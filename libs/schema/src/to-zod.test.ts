import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import { s } from "./index";
import { toZod } from "./to-zod";

describe("toZod - primitives", () => {
  it("converts string schema", () => {
    const schema = s.string();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();

    expect(zodSchema.parse("hello")).toBe("hello");
    expect(() => zodSchema.parse(123)).toThrow();
  });

  it("converts number schema", () => {
    const schema = s.number();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<number>();

    expect(zodSchema.parse(123)).toBe(123);
    expect(() => zodSchema.parse("123")).toThrow();
  });

  it("converts boolean schema", () => {
    const schema = s.boolean();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<boolean>();

    expect(zodSchema.parse(true)).toBe(true);
    expect(zodSchema.parse(false)).toBe(false);
    expect(() => zodSchema.parse("true")).toThrow();
  });

  it("converts null schema", () => {
    const schema = s.null();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<null>();

    expect(zodSchema.parse(null)).toBe(null);
    expect(() => zodSchema.parse(undefined)).toThrow();
  });

  it("converts undefined schema", () => {
    const schema = s.undefined();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<undefined>();

    expect(zodSchema.parse(undefined)).toBe(undefined);
    expect(() => zodSchema.parse(null)).toThrow();
  });

  it("converts unknown schema", () => {
    const schema = s.unknown();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<unknown>();

    expect(zodSchema.parse("anything")).toBe("anything");
    expect(zodSchema.parse(123)).toBe(123);
    expect(zodSchema.parse(null)).toBe(null);
  });

  it("converts date schema", () => {
    const schema = s.date();
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<Date>();

    const date = new Date();
    expect(zodSchema.parse(date)).toBe(date);
    expect(() => zodSchema.parse("2024-01-01")).toThrow();
  });
});

describe("toZod - literals and enums", () => {
  it("converts string literal schema", () => {
    const schema = s.literal("hello");
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<"hello">();

    expect(zodSchema.parse("hello")).toBe("hello");
    expect(() => zodSchema.parse("world")).toThrow();
  });

  it("converts number literal schema", () => {
    const schema = s.literal(42);
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<42>();

    expect(zodSchema.parse(42)).toBe(42);
    expect(() => zodSchema.parse(43)).toThrow();
  });

  it("converts boolean literal schema", () => {
    const schema = s.literal(true);
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<true>();

    expect(zodSchema.parse(true)).toBe(true);
    expect(() => zodSchema.parse(false)).toThrow();
  });

  it("converts enum schema", () => {
    const schema = s.enum(["a", "b", "c"]);
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<"a" | "b" | "c">();

    expect(zodSchema.parse("a")).toBe("a");
    expect(zodSchema.parse("b")).toBe("b");
    expect(() => zodSchema.parse("d")).toThrow();
  });
});

describe("toZod - arrays", () => {
  it("converts string array schema", () => {
    const schema = s.array(s.string());
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<string[]>();

    expect(zodSchema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => zodSchema.parse([1, 2])).toThrow();
  });

  it("converts nested array schema", () => {
    const schema = s.array(s.array(s.number()));
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<number[][]>();

    expect(zodSchema.parse([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
    expect(() => zodSchema.parse([["a", "b"]])).toThrow();
  });
});

describe("toZod - objects", () => {
  it("converts simple object schema", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number(),
    });
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();

    expect(zodSchema.parse({ name: "John", age: 30 })).toEqual({ name: "John", age: 30 });
    expect(() => zodSchema.parse({ name: "John" })).toThrow();
  });

  it("converts object with optional fields", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number().optional(),
    });
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age?: number | undefined }>();

    expect(zodSchema.parse({ name: "John", age: 30 })).toEqual({ name: "John", age: 30 });
    expect(zodSchema.parse({ name: "John" })).toEqual({ name: "John" });
  });

  it("converts nested object schema", () => {
    const schema = s.object({
      user: s.object({
        name: s.string(),
        email: s.string(),
      }),
      meta: s.object({
        created: s.date(),
      }),
    });
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<{
      user: { name: string; email: string };
      meta: { created: Date };
    }>();

    const date = new Date();
    expect(zodSchema.parse({
      user: { name: "John", email: "john@example.com" },
      meta: { created: date },
    })).toEqual({
      user: { name: "John", email: "john@example.com" },
      meta: { created: date },
    });
  });
});

describe("toZod - records", () => {
  it("converts string record schema", () => {
    const schema = s.record(s.string(), s.number());
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<Record<string, number>>();

    expect(zodSchema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(() => zodSchema.parse({ a: "1", b: "2" })).toThrow();
  });
});

describe("toZod - instanceof", () => {
  it("converts instanceof schema", () => {
    class MyClass {
      constructor(public value: string) {}
    }

    const schema = s.instanceof(MyClass);
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<MyClass>();

    const instance = new MyClass("test");
    expect(zodSchema.parse(instance)).toBe(instance);
    expect(() => zodSchema.parse({ value: "test" })).toThrow();
  });
});

describe("toZod - custom", () => {
  it("converts custom schema", () => {
    const schema = s.custom<string>((val) => typeof val === "string" && val.length > 0);
    const zodSchema = toZod(schema);

    type Result = z.infer<typeof zodSchema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();

    expect(zodSchema.parse("hello")).toBe("hello");
    expect(() => zodSchema.parse("")).toThrow();
  });
});
