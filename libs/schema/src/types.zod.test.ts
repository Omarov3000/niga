// import { describe, it, expectTypeOf } from "vitest";
// import { z } from "zod";

// describe("Primitives", () => {
//   it("string", () => {
//     const schema = z.string();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string>();
//   });

//   it("number", () => {
//     const schema = z.number();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<number>();
//   });

//   it("boolean", () => {
//     const schema = z.boolean();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<boolean>();
//   });

//   it("date", () => {
//     const schema = z.date();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<Date>();
//   });

//   it("null", () => {
//     const schema = z.null();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<null>();
//   });

//   it("undefined", () => {
//     const schema = z.undefined();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<undefined>();
//   });

//   it("unknown", () => {
//     const schema = z.unknown();
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<unknown>();
//   });

//     it("string literal", () => {
//     const schema = z.literal("hello");
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<"hello">();
//   });

//   it("number literal", () => {
//     const schema = z.literal(42);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<42>();
//   });

//   it("string enum", () => {
//     const schema = z.enum(["a", "b", "c"]);
//     type Result = z.infer<typeof schema>;
//     type Expected = "a" | "b" | "c";
//     expectTypeOf<Result>().toEqualTypeOf<Expected>();
//   });

//   it('custom', () => {
//     const schema = z.custom<string>((val) => (val as string).length > 0);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string>();
//   })

//   it('custom recursive', () => {
//     type Recursive = { name: string;  children: Recursive[] }
//     const recursiveSchema = z.custom<Recursive>((val) => (val as Recursive).name.length > 0);
//     type Result = z.infer<typeof recursiveSchema>;
//     expectTypeOf<Result>().toEqualTypeOf<Recursive>();
//   })
// });

// describe("Array", () => {
//   it("string array", () => {
//     const schema = z.array(z.string());
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string[]>();
//   });

//   it("nested array", () => {
//     const schema = z.array(z.array(z.string()));
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string[][]>();
//   });
// });

// describe("Object", () => {
//   it("simple object", () => {
//     const schema = z.object({
//       name: z.string(),
//       age: z.number().optional(),
//     });
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name: string; age?: number | undefined }>();
//   });

//   it("nested object", () => {
//     const schema = z.object({
//       user: z.object({
//         name: z.string(),
//         email: z.string(),
//       }),
//       meta: z.object({
//         created: z.date(),
//       }),
//     });
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<{
//       user: { name: string; email: string };
//       meta: { created: Date };
//     }>();
//   });

//   it("object.extend", () => {
//     const base = z.object({ name: z.string() });
//     const extended = base.extend({ age: z.number() });
//     type Result = z.infer<typeof extended>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
//   });

//   it("object.pick", () => {
//     const schema = z.object({
//       name: z.string(),
//       age: z.number(),
//       email: z.string(),
//     });
//     const picked = schema.pick({ name: true, age: true });
//     type Result = z.infer<typeof picked>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
//   });

//   it("object.omit", () => {
//     const schema = z.object({
//       name: z.string(),
//       age: z.number(),
//       email: z.string(),
//     });
//     const omitted = schema.omit({ email: true });
//     type Result = z.infer<typeof omitted>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
//   });

//   it("object.partial", () => {
//     const schema = z.object({
//       name: z.string(),
//       age: z.number(),
//     });
//     const partial = schema.partial();
//     type Result = z.infer<typeof partial>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name?: string; age?: number }>();
//   });
// });

// describe("Record", () => {
//   it("string record", () => {
//     const schema = z.record(z.string(), z.number());
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<Record<string, number>>();
//   });
// });

// describe("Union", () => {
//   it("string | number", () => {
//     const schema = z.union([z.string(), z.number()]);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string | number>();
//   });

//   it("complex union", () => {
//     const schema = z.union([
//       z.object({ type: z.literal("a"), value: z.string() }),
//       z.object({ type: z.literal("b"), value: z.number() }),
//     ]);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<
//       { type: "a"; value: string } | { type: "b"; value: number }
//     >();
//   });
// });

// describe("Discriminated Union", () => {
//   it("discriminated union", () => {
//     const schema = z.discriminatedUnion("kind", [
//       z.object({ kind: z.literal("circle"), radius: z.number() }),
//       z.object({ kind: z.literal("square"), size: z.number() }),
//     ]);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<
//       { kind: "circle"; radius: number } | { kind: "square"; size: number }
//     >();
//   });
// });

// describe("Transform", () => {
//   it("string to number", () => {
//     const schema = z.string().transform((val) => val.length);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<number>();

//     type Input = z.input<typeof schema>;
//     type Output = z.output<typeof schema>;

//     expectTypeOf<Input>().toEqualTypeOf<string>();
//     expectTypeOf<Output>().toEqualTypeOf<number>();
//   });

//   it("object transform", () => {
//     const schema = z
//       .object({ name: z.string() })
//       .transform((obj) => obj.name.toUpperCase());
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string>();
//   });
// });

// describe("Default", () => {
//   it("string with default", () => {
//     const schema = z.string().default("hello");
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string>();
//   });

//   it("number with default", () => {
//     const schema = z.number().default(42);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<number>();
//   });
// });

// describe("Refine", () => {
//   it("refine preserves type", () => {
//     const schema = z.string().refine((val) => val.length > 0);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<string>();
//   });

//   it("refine on object preserves type", () => {
//     const schema = z
//       .object({ age: z.number() })
//       .refine((obj) => obj.age >= 18);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<{ age: number }>();
//   });
// });

// describe("Catch", () => {
//   it("catch preserves type", () => {
//     const schema = z.number().catch(0);
//     type Result = z.infer<typeof schema>;
//     expectTypeOf<Result>().toEqualTypeOf<number>();
//   });
// });

// describe("Complex real-world schemas", () => {
//   it('self referencing type', () => {
//     const Category = z.object({
//       name: z.string(),
//       get subcategories() {
//         return z.array(Category);
//       },
//     });

//     type Result = z.infer<typeof Category>;
//     expectTypeOf<Result>().toEqualTypeOf<{ name: string; subcategories: Result[] }>();
//   });

//   it("user profile", () => {
//     const UserProfile = z.object({
//       id: z.string(),
//       email: z.string().email(),
//       name: z.string().min(1),
//       age: z.number().int().positive().max(150),
//       role: z.enum(["admin", "user", "guest"]),
//       metadata: z.record(z.string(), z.unknown()),
//       createdAt: z.date(),
//     });

//     type Result = z.infer<typeof UserProfile>;

//     expectTypeOf<Result>().toEqualTypeOf<{
//       id: string;
//       email: string;
//       name: string;
//       age: number;
//       role: "admin" | "user" | "guest";
//       metadata: Record<string, unknown>;
//       createdAt: Date;
//     }>();
//   });

//   it("API response", () => {
//     const SuccessResponse = z.object({
//       success: z.literal(true),
//       data: z.unknown(),
//     });

//     const ErrorResponse = z.object({
//       success: z.literal(false),
//       error: z.string(),
//     });

//     const ApiResponse = z.union([SuccessResponse, ErrorResponse]);

//     type Result = z.infer<typeof ApiResponse>;
//     type Expected =
//       | { success: true; data: unknown }
//       | { success: false; error: string };

//     expectTypeOf<Result>().toEqualTypeOf<Expected>();
//   });
// });
