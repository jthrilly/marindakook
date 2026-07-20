/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { siteSchema } from "@site/lib/content-schema";
import siteRaw from "../../content/site.json?raw";
import { buildContentSource } from "../src/index";

const ENV = { GITHUB_OWNER: "marinda", GITHUB_REPO: "marindakook" };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// The frozen build-time bundle — the merge/edit base the stale-bundle bug came
// from. loadSite must read LIVE committed state, using this only as a fallback.
const bundledSite = siteSchema.parse(JSON.parse(siteRaw));

describe("buildContentSource.loadSite reads live committed state", () => {
  it("returns the LIVE fetched site when the raw fetch succeeds", async () => {
    const liveSite = { ...bundledSite, tagline: "LEWENDE-BYSKRIF" };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(liveSite));

    const content = buildContentSource(ENV, fetchMock);
    const site = await content?.loadSite();

    expect(site?.tagline).toBe("LEWENDE-BYSKRIF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/content/site.json");
  });

  it("falls back to the bundled site when the fetch fails (non-200)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));

    const content = buildContentSource(ENV, fetchMock);
    const site = await content?.loadSite();

    expect(site?.tagline).toBe(bundledSite.tagline);
  });
});
