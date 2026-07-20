/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { signLink } from "../src/core/links";

const BASE = "https://cms.example";

describe("Worker routing", () => {
  it("POST /mcp without a token is 401 (OAuth-protected)", async () => {
    const response = await SELF.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("GET /login renders the Afrikaans login page", async () => {
    const response = await SELF.fetch(`${BASE}/login`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Meld aan");
  });

  it("GET /upload with a bad signature renders the expired page (200, never a bare 403)", async () => {
    const response = await SELF.fetch(`${BASE}/upload?sig=onsin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("verval");
  });

  it("GET /preview with a bad signature renders the expired page (200)", async () => {
    const response = await SELF.fetch(`${BASE}/preview?sig=onsin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("verval");
  });

  it("GET /upload with a valid signature renders the upload page", async () => {
    const sig = await signLink({ draftId: "d-1", kind: "upload" }, env.LINK_SECRET);
    const response = await SELF.fetch(`${BASE}/upload?sig=${sig}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Laai jou foto's");
  });

  it("an upload token cannot open the preview page (kind is bound)", async () => {
    const sig = await signLink({ draftId: "d-1", kind: "upload" }, env.LINK_SECRET);
    const response = await SELF.fetch(`${BASE}/preview?sig=${sig}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("verval");
  });

  it("unknown paths are 404", async () => {
    const response = await SELF.fetch(`${BASE}/onbekend`);
    expect(response.status).toBe(404);
  });
});
