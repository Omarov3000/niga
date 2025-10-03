import { s } from "./src/index";
import { z } from "zod";
// optionality

const schema = s.object({
  name: s.string(),
  age: s.number().optional(),
});
type Result = s.infer<typeof schema>;

const zodOptional = z.object({
  name: z.string(),
  age: z.number().optional(),
});
type ZodResult = z.infer<typeof zodOptional>;

// recursive

// const Category = s.object({
//   name: s.string(),
//   get subcategories() {
//     return s.array(Category);
//   },
// });

// // Check what type Category has
// type Cat = typeof Category;

// // Check what the inferred output type is
// type CatOutput = s.infer<typeof Category>;
