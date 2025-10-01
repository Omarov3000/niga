import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getDefaultValueFromZodSchema } from './get-default-value-from-zod-schema';


describe("getDefaultValueFromZodSchema", () => {
  it("handles primitives", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      name: "",
      age: 0,
      active: false,
    });
  });

  it("handles arrays", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      tags: [],
    });
  });

  it("handles nested objects", () => {
    const schema = z.object({
      profile: z.object({
        username: z.string(),
        email: z.string(),
      }),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      profile: {
        username: "",
        email: "",
      },
    });
  });

  it("handles enums", () => {
    const schema = z.object({
      role: z.enum(["admin", "user", "guest"]),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      role: "admin",
    });
  });

  it("handles literals", () => {
    const schema = z.object({
      kind: z.literal("fixed"),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      kind: "fixed",
    });
  });

  it("handles defaults", () => {
    const schema = z.object({
      count: z.number().default(42),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      count: 42,
    });
  });

  it("handles unions", () => {
    const schema = z.object({
      value: z.union([z.string(), z.number()]),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      value: "",
    });
  });

  it("handles optional and nullable", () => {
    const schema = z.object({
      maybe: z.string().optional(),
      nullable: z.string().nullable(),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      maybe: undefined,
      nullable: null,
    });
  });

  it("handles complex nested schemas", () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          name: z.string(),
          settings: z.object({
            theme: z.enum(["dark", "light"]),
            notifications: z.boolean().default(true),
          }),
        }),
        tags: z.array(z.string()),
      }),
      metadata: z.object({
        version: z.literal("1.0"),
        optional: z.number().optional(),
      }),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toMatchObject({
      user: {
        profile: {
          name: "",
          settings: {
            theme: "dark",
            notifications: true,
          },
        },
        tags: [],
      },
      metadata: {
        version: "1.0",
        optional: undefined,
      },
    });
  });

  it("handles arrays of objects", () => {
    const schema = z.object({
      items: z.array(z.object({
        id: z.number(),
        name: z.string(),
      })),
    });

    const data = getDefaultValueFromZodSchema(schema);
    expect(data).toEqual({
      items: [],
    });
  });
});
