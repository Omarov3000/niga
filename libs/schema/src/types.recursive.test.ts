import { describe, it, expectTypeOf } from "vitest";
import { s } from "./index";


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
