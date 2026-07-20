import { describe, expect, it } from "vitest";
import { slugify, resolveSlug } from "../src/core/slug";

describe("slugify", () => {
  it("lowercases, strips diacritics, hyphenates (matches the WP convention)", () => {
    expect(slugify("Lemoen Stroopkoek")).toBe("lemoen-stroopkoek");
    expect(slugify("Kategorieë & Poffertjies!")).toBe("kategoriee-poffertjies");
    expect(slugify("  3 Bestanddele  ")).toBe("3-bestanddele");
  });
});

describe("resolveSlug", () => {
  it("returns the base when free", () => {
    expect(resolveSlug("piesangbrood", new Set())).toBe("piesangbrood");
  });
  it("suffixes -2, -3 on collision (matches legacy boontjiebredie-2 pattern)", () => {
    expect(resolveSlug("piesangbrood", new Set(["piesangbrood"]))).toBe("piesangbrood-2");
    expect(resolveSlug("piesangbrood", new Set(["piesangbrood", "piesangbrood-2"]))).toBe(
      "piesangbrood-3",
    );
  });
  it("treats reserved segments as taken", () => {
    expect(resolveSlug("category", new Set(["category"]))).toBe("category-2");
  });
});
