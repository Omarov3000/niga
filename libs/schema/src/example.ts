import z from "zod";

const Category = z.object({
  name: z.string(),
  get subcategories() {
    return z.array(Category);
  },
});

// import { s } from "./index";

// // Example from schema.md
// const Player = s.object({
//   username: s.string(),
//   xp: s.number(),
// });

// try {
//   Player.parse({ username: 42, xp: "100" });
// } catch (error) {
//   if (error instanceof s.SchemaError) {
//     console.log("Issues:", JSON.stringify(error.issues, null, 2));
//   }
// }

// const result = Player.safeParse({ username: 42, xp: "100" });
// if (!result.success) {
//   console.log("Error:", result.error.issues);
// } else {
//   console.log("Data:", result.data);
// }

// // Type inference
// type PlayerType = s.infer<typeof Player>;

// // Self-referencing type (from requirements)
// const Category = s.object({
//   name: s.string(),
//   get subcategories() {
//     return s.array(Category);
//   },
// });

// type CategoryType = s.infer<typeof Category>;
// // CategoryType = { name: string; subcategories: CategoryType[] }

// // String validators
// const email = s.string().email();
// const url = s.string().httpUrl();
// const upperCase = s.string().uppercase();

// // Number validators
// const positiveInt = s.number().int().positive();
// const inRange = s.number().min(0).max(100);

// // Date validator
// const futureDate = s.date().min(new Date());

// // Object methods
// const User = s.object({
//   name: s.string(),
//   email: s.string().email(),
//   age: s.number(),
// });

// const ExtendedUser = User.extend({
//   role: s.literal("admin"),
// });

// const PartialUser = User.partial();

// // Union
// const StringOrNumber = s.union([s.string(), s.number()]);

// // Discriminated union
// const Shape = s.discriminatedUnion("kind", [
//   s.object({ kind: s.literal("circle"), radius: s.number() }),
//   s.object({ kind: s.literal("square"), size: s.number() }),
// ]);

// // Transform
// const StringLength = s.transform(s.string(), (str) => str.length);

// // Refine
// const NonEmptyString = s.refine(s.string(), (val) => val.length > 0, {
//   message: "String must not be empty",
// });

// // Default
// const WithDefault = s.default(s.string(), "default value");

// // Catch
// const SafeNumber = s.catch(s.number(), 0);

// console.log("All examples compiled successfully!");
