import { describe, expect, it } from "vitest";
import { chromeDraftSchema, draftPostSchema } from "../src/core/draft-schema";

const envelope = {
  draftId: "d-piesangbrood",
  createdAt: "2026-07-20T09:00:00.000Z",
  updatedAt: "2026-07-20T09:05:00.000Z",
};

describe("draftPostSchema", () => {
  it("accepts a minimal half-finished draft (just a title)", () => {
    const draft = { ...envelope, kind: "post", title: "Piesangbrood" };
    expect(draftPostSchema.parse(draft)).toEqual(draft);
  });

  it("accepts partial interview and recipe state", () => {
    const draft = {
      ...envelope,
      kind: "post",
      title: "Piesangbrood",
      categories: [12],
      recipe: { ingredientGroups: [{ items: ["3 ryp piesangs"] }] },
      interview: { settled: ["titel"], pending: ["bestanddele"], featured: false },
    };
    expect(draftPostSchema.parse(draft)).toEqual(draft);
  });

  it("rejects an unknown top-level key (strict)", () => {
    const draft = { ...envelope, kind: "post", title: "Piesangbrood", bogus: true };
    expect(draftPostSchema.safeParse(draft).success).toBe(false);
  });

  it("requires the internal envelope fields", () => {
    const draft = { kind: "post", title: "Piesangbrood" };
    expect(draftPostSchema.safeParse(draft).success).toBe(false);
  });
});

describe("chromeDraftSchema", () => {
  it("accepts a minimal chrome edit touching one string", () => {
    const draft = {
      draftId: "d-chrome",
      kind: "chrome",
      site: { tagline: "Tuisgemaakte resepte" },
      updatedAt: "2026-07-20T09:05:00.000Z",
    };
    expect(chromeDraftSchema.parse(draft)).toEqual(draft);
  });

  it("rejects an unknown top-level key (strict)", () => {
    const draft = {
      draftId: "d-chrome",
      kind: "chrome",
      site: {},
      updatedAt: "2026-07-20T09:05:00.000Z",
      bogus: true,
    };
    expect(chromeDraftSchema.safeParse(draft).success).toBe(false);
  });
});
