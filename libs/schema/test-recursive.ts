import { s } from "./src/index";

const Category = s.object({
  name: s.string(),
  get subcategories() {
    return s.array(Category);
  },
});

// Check what type Category has
type Cat = typeof Category;

// Check what the inferred output type is
type CatOutput = s.infer<typeof Category>;
