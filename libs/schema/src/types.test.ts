import { describe, it, expectTypeOf } from "vitest";
import { s } from "./index";

describe("Primitives", () => {
  it("string", () => {
    const schema = s.string();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();
  });

  it("number", () => {
    const schema = s.number();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<number>();
  });

  it("boolean", () => {
    const schema = s.boolean();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<boolean>();
  });

  it("date", () => {
    const schema = s.date();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<Date>();
  });

  it("null", () => {
    const schema = s.null();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<null>();
  });

  it("undefined", () => {
    const schema = s.undefined();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<undefined>();
  });

  it("unknown", () => {
    const schema = s.unknown();
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<unknown>();
  });

    it("string literal", () => {
    const schema = s.literal("hello");
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<"hello">();
  });

  it("number literal", () => {
    const schema = s.literal(42);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<42>();
  });

  it("string enum", () => {
    const schema = s.enum(["a", "b", "c"]);
    type Result = s.infer<typeof schema>;
    type Expected = "a" | "b" | "c";
    expectTypeOf<Result>().toEqualTypeOf<Expected>();
  });

  it('custom', () => {
    const schema = s.custom<string>((val) => val.length > 0);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();
  })

  it('custom recursive', () => {
    type Recursive = { name: string;  children: Recursive[] }
    const recursiveSchema = s.custom<Recursive>((val) => val.name.length > 0);
    type Result = s.infer<typeof recursiveSchema>;
    expectTypeOf<Result>().toEqualTypeOf<Recursive>();
  })
});

describe("Array", () => {
  it("string array", () => {
    const schema = s.array(s.string());
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string[]>();
  });

  it("nested array", () => {
    const schema = s.array(s.array(s.string()));
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string[][]>();
  });
});

describe("Object", () => {
  it("simple object", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number().optional(),
    });
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age?: number | undefined }>();
  });

  it("nested object", () => {
    const schema = s.object({
      user: s.object({
        name: s.string(),
        email: s.string(),
      }),
      meta: s.object({
        created: s.date(),
      }),
    });
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<{
      user: { name: string; email: string };
      meta: { created: Date };
    }>();
  });

  it("object.extend", () => {
    const base = s.object({ name: s.string() });
    const extended = base.extend({ age: s.number() });
    type Result = s.infer<typeof extended>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
  });

  it("object.pick", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number(),
      email: s.string(),
    });
    const picked = schema.pick("name", "age");
    type Result = s.infer<typeof picked>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
  });

  it("object.omit", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number(),
      email: s.string(),
    });
    const omitted = schema.omit("email");
    type Result = s.infer<typeof omitted>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
  });

  it("object.partial", () => {
    const schema = s.object({
      name: s.string(),
      age: s.number(),
    });
    const partial = schema.partial();
    type Result = s.infer<typeof partial>;
    expectTypeOf<Result>().toEqualTypeOf<{ name?: string; age?: number }>();
  });
});

describe("Record", () => {
  it("string record", () => {
    const schema = s.record(s.string(), s.number());
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<Record<string, number>>();
  });
});

describe("Union", () => {
  it("string | number", () => {
    const schema = s.union([s.string(), s.number()]);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string | number>();
  });

  it("complex union", () => {
    const schema = s.union([
      s.object({ type: s.literal("a"), value: s.string() }),
      s.object({ type: s.literal("b"), value: s.number() }),
    ]);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<
      { type: "a"; value: string } | { type: "b"; value: number }
    >();
  });
});

describe("Discriminated Union", () => {
  it("discriminated union", () => {
    const schema = s.discriminatedUnion("kind", [
      s.object({ kind: s.literal("circle"), radius: s.number() }),
      s.object({ kind: s.literal("square"), size: s.number() }),
    ]);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<
      { kind: "circle"; radius: number } | { kind: "square"; size: number }
    >();
  });
});

describe("Transform", () => {
  it("string to number", () => {
    const schema = s.transform(s.string(), (val) => val.length);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<number>();

    type Input = s.input<typeof schema>;
    type Output = s.output<typeof schema>;

    expectTypeOf<Input>().toEqualTypeOf<string>();
    expectTypeOf<Output>().toEqualTypeOf<number>();
  });

  it("object transform", () => {
    const schema = s.transform(
      s.object({ name: s.string() }),
      (obj) => obj.name.toUpperCase()
    );
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();
  });
});

describe("Default", () => {
  it("string with default", () => {
    const schema = s.default(s.string(), "hello");
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();
  });

  it("number with default", () => {
    const schema = s.default(s.number(), 42);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<number>();
  });
});

describe("Refine", () => {
  it("refine preserves type", () => {
    const schema = s.refine(s.string(), (val) => val.length > 0);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<string>();
  });

  it("refine on object preserves type", () => {
    const schema = s.refine(
      s.object({ age: s.number() }),
      (obj) => obj.age >= 18
    );
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<{ age: number }>();
  });
});

describe("Catch", () => {
  it("catch preserves type", () => {
    const schema = s.catch(s.number(), 0);
    type Result = s.infer<typeof schema>;
    expectTypeOf<Result>().toEqualTypeOf<number>();
  });
});

describe("Complex real-world schemas", () => {
  it('self referencing type', () => {
    const Category = s.object({
      name: s.string(),
      get subcategories() {
        return s.array(Category);
      },
    });

    type Result = s.infer<typeof Category>;
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; subcategories: Result[] }>();
  });

  it("user profile", () => {
    const UserProfile = s.object({
      id: s.string(),
      email: s.string().email(),
      name: s.string().min(1),
      age: s.number().int().positive().max(150),
      role: s.enum(["admin", "user", "guest"]),
      metadata: s.record(s.string(), s.unknown()),
      createdAt: s.date(),
    });

    type Result = s.infer<typeof UserProfile>;

    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      email: string;
      name: string;
      age: number;
      role: "admin" | "user" | "guest";
      metadata: Record<string, unknown>;
      createdAt: Date;
    }>();
  });

  it("API response", () => {
    const SuccessResponse = s.object({
      success: s.literal(true),
      data: s.unknown(),
    });

    const ErrorResponse = s.object({
      success: s.literal(false),
      error: s.string(),
    });

    const ApiResponse = s.union([SuccessResponse, ErrorResponse]);

    type Result = s.infer<typeof ApiResponse>;
    type Expected =
      | { success: true; data: unknown }
      | { success: false; error: string };

    expectTypeOf<Result>().toEqualTypeOf<Expected>();
  });
});
