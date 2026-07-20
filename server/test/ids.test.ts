import { describe, expect, it } from "vitest";
import { nextPostId, nextTermId } from "../src/core/ids";

describe("nextPostId", () => {
  it("returns one past the current maximum", () => {
    expect(nextPostId([7621, 5236, 1])).toBe(7622);
  });
  it("starts at 1 when there are no existing ids", () => {
    expect(nextPostId([])).toBe(1);
  });
});

describe("nextTermId", () => {
  it("uses the same allocation rule over the term id space", () => {
    expect(nextTermId([7621, 5236, 1])).toBe(7622);
    expect(nextTermId([])).toBe(1);
  });
});
