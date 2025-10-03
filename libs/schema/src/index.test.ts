import { describe, it, expect } from "vitest";
import { s } from "./index";

describe("Schema Library", () => {
  describe("string", () => {
    it("should validate strings", () => {
      const schema = s.string();
      expect(schema.parse("hello")).toBe("hello");
    });

    it("should reject non-strings", () => {
      const schema = s.string();
      expect(() => schema.parse(123)).toThrow(s.SchemaError);
    });

    it("should validate min length", () => {
      const schema = s.string().min(5);
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("hi")).toThrow();
    });

    it("should validate max length", () => {
      const schema = s.string().max(5);
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("hello world")).toThrow();
    });

    it("should validate email", () => {
      const schema = s.string().email();
      expect(schema.parse("test@example.com")).toBe("test@example.com");
      expect(() => schema.parse("invalid")).toThrow();
    });

    it("should transform to uppercase", () => {
      const schema = s.string().uppercase();
      expect(schema.parse("hello")).toBe("HELLO");
    });

    it("should transform to lowercase", () => {
      const schema = s.string().lowercase();
      expect(schema.parse("HELLO")).toBe("hello");
    });

    it("should trim strings", () => {
      const schema = s.string().trim();
      expect(schema.parse("  hello  ")).toBe("hello");
    });
  });

  describe("number", () => {
    it("should validate numbers", () => {
      const schema = s.number();
      expect(schema.parse(123)).toBe(123);
    });

    it("should reject non-numbers", () => {
      const schema = s.number();
      expect(() => schema.parse("123")).toThrow();
    });

    it("should validate min", () => {
      const schema = s.number().min(5);
      expect(schema.parse(10)).toBe(10);
      expect(() => schema.parse(3)).toThrow();
    });

    it("should validate max", () => {
      const schema = s.number().max(10);
      expect(schema.parse(5)).toBe(5);
      expect(() => schema.parse(15)).toThrow();
    });

    it("should validate int", () => {
      const schema = s.number().int();
      expect(schema.parse(5)).toBe(5);
      expect(() => schema.parse(5.5)).toThrow();
    });

    it("should validate positive", () => {
      const schema = s.number().positive();
      expect(schema.parse(5)).toBe(5);
      expect(() => schema.parse(-5)).toThrow();
    });
  });

  describe("boolean", () => {
    it("should validate booleans", () => {
      const schema = s.boolean();
      expect(schema.parse(true)).toBe(true);
      expect(schema.parse(false)).toBe(false);
    });

    it("should reject non-booleans", () => {
      const schema = s.boolean();
      expect(() => schema.parse("true")).toThrow();
    });
  });

  describe("date", () => {
    it("should validate dates", () => {
      const schema = s.date();
      const date = new Date();
      expect(schema.parse(date)).toEqual(date);
    });

    it("should parse date strings", () => {
      const schema = s.date();
      const result = schema.parse("2022-01-12T06:15:00.000Z");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2022-01-12T06:15:00.000Z");
    });

    it("should reject invalid dates", () => {
      const schema = s.date();
      expect(() => schema.parse("invalid")).toThrow();
    });
  });

  describe("literal", () => {
    it("should validate literal values", () => {
      const schema = s.literal("hello");
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("world")).toThrow();
    });
  });

  describe("enum", () => {
    it("should validate enum values", () => {
      const schema = s.enum(["a", "b", "c"]);
      expect(schema.parse("a")).toBe("a");
      expect(() => schema.parse("d")).toThrow();
    });

    it("should expose options", () => {
      const schema = s.enum(["a", "b", "c"]);
      expect(schema.options).toEqual(["a", "b", "c"]);
    });
  });

  describe("array", () => {
    it("should validate arrays", () => {
      const schema = s.array(s.string());
      expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    });

    it("should validate array elements", () => {
      const schema = s.array(s.number());
      expect(() => schema.parse([1, "2", 3])).toThrow();
    });
  });

  describe("object", () => {
    it("should validate objects", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
      });

      const result = schema.parse({ name: "John", age: 30 });
      expect(result).toMatchObject({ name: "John", age: 30 });
    });

    it("should reject missing properties", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
      });

      expect(() => schema.parse({ name: "John" })).toThrow();
    });

    it("should extend objects", () => {
      const base = s.object({ name: s.string() });
      const extended = base.extend({ age: s.number() });

      const result = extended.parse({ name: "John", age: 30 });
      expect(result).toMatchObject({ name: "John", age: 30 });
    });

    it("should pick properties", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
        email: s.string(),
      });

      const picked = schema.pick("name", "age");
      const result = picked.parse({ name: "John", age: 30 });
      expect(result).toMatchObject({ name: "John", age: 30 });
    });

    it("should omit properties", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
        email: s.string(),
      });

      const omitted = schema.omit("email");
      const result = omitted.parse({ name: "John", age: 30 });
      expect(result).toMatchObject({ name: "John", age: 30 });
    });

    it("should make partial", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
      });

      const partial = schema.partial();
      const result = partial.parse({ name: "John" });
      expect(result).toMatchObject({ name: "John" });
    });
  });

  describe("union", () => {
    it("should validate unions", () => {
      const schema = s.union([s.string(), s.number()]);
      expect(schema.parse("hello")).toBe("hello");
      expect(schema.parse(123)).toBe(123);
      expect(() => schema.parse(true)).toThrow();
    });
  });

  describe("refine", () => {
    it("should add custom validation", () => {
      const schema = s.refine(s.string(), (val) => val.length > 0, "String must not be empty");
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("")).toThrow();
    });
  });

  describe("transform", () => {
    it("should transform values", () => {
      const schema = s.transform(s.string(), (val) => val.length);
      expect(schema.parse("hello")).toBe(5);
    });
  });

  describe("default", () => {
    it("should use default value", () => {
      const schema = s.default(s.string(), "default");
      expect(schema.parse(undefined)).toBe("default");
      expect(schema.parse("custom")).toBe("custom");
    });
  });

  describe("catch", () => {
    it("should catch errors and use fallback", () => {
      const schema = s.catch(s.number(), 0);
      expect(schema.parse(123)).toBe(123);
      expect(schema.parse("invalid")).toBe(0);
    });
  });

  describe("custom", () => {
    it("should validate with custom function", () => {
      const schema = s.custom<string>((val) => val.length > 0);
      expect(schema.parse("hello")).toBe("hello");
      expect(() => schema.parse("")).toThrow();
    });

    it("should work with complex types", () => {
      type Person = { name: string; age: number };
      const schema = s.custom<Person>((val) => val.age >= 18);
      expect(schema.parse({ name: "John", age: 25 })).toMatchObject({ name: "John", age: 25 });
      expect(() => schema.parse({ name: "Jane", age: 15 })).toThrow();
    });
  });

  describe("safeParse", () => {
    it("should return success result", () => {
      const schema = s.string();
      const result = schema.safeParse("hello");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("hello");
      }
    });

    it("should return error result", () => {
      const schema = s.string();
      const result = schema.safeParse(123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(s.SchemaError);
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("type inference", () => {
    it("should infer correct types", () => {
      const PlayerSchema = s.object({
        username: s.string(),
        xp: s.number(),
      });

      type PlayerType = s.infer<typeof PlayerSchema>;
      const player: PlayerType = { username: "player1", xp: 100 };
      expect(PlayerSchema.parse(player)).toMatchObject(player);
    });
  });

  describe("meta", () => {
    it("should add metadata to string schema", () => {
      const schema = s.string().meta({ id: "email_field", title: "Email" });
      expect(schema._zod.meta).toMatchObject({ id: "email_field", title: "Email" });
    });

    it("should add metadata to number schema", () => {
      const schema = s.number().meta({ id: "age_field", min: 0, max: 120 });
      expect(schema._zod.meta).toMatchObject({ id: "age_field", min: 0, max: 120 });
    });

    it("should merge metadata", () => {
      const schema = s.string().meta({ id: "field1" }).meta({ title: "Field 1" });
      expect(schema._zod.meta).toMatchObject({ id: "field1", title: "Field 1" });
    });

    it("should store any object in meta", () => {
      const schema = s.string().meta({
        id: "email_address",
        title: "Email address",
        description: "Please enter a valid email address",
        custom: { nested: { data: true } },
        array: [1, 2, 3],
      });
      expect(schema._zod.meta).toMatchObject({
        id: "email_address",
        title: "Email address",
        description: "Please enter a valid email address",
        custom: { nested: { data: true } },
        array: [1, 2, 3],
      });
    });

    it("should preserve metadata after validation", () => {
      const schema = s.string().email().meta({ id: "email_field" });
      expect(schema._zod.meta).toMatchObject({ id: "email_field" });
      schema.parse("test@example.com");
      expect(schema._zod.meta).toMatchObject({ id: "email_field" });
    });
  });
});
