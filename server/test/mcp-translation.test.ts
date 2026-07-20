import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStore } from "../src/core/store";
import type { DraftPost } from "../src/core/draft-schema";
import { createMcpServer, type McpServerDeps } from "../src/mcp/server";

const NOW = "2026-07-20T09:00:00.000Z";

function draft(overrides: Partial<DraftPost> = {}): DraftPost {
  return {
    draftId: "d-9",
    kind: "post",
    createdAt: NOW,
    updatedAt: NOW,
    title: "Melktert",
    slug: "melktert",
    excerpt: "Klassieke tert",
    html: "<p>Roer die vulsel</p>",
    seo: { title: "Melktert - Marinda Kook", description: null },
    ...overrides,
  };
}

function goodCandidate(): Record<string, unknown> {
  return {
    id: "d-9",
    slug: "melktert",
    sourceHash: "",
    title: "Milk tart",
    excerpt: "Classic tart",
    seo: { title: "Milk tart - Marinda Kook", description: null },
    html: "<p>Stir the filling</p>",
  };
}

function anthropicResponse(candidate: unknown): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify(candidate) }] }),
    { status: 200 },
  );
}

interface Harness {
  client: Client;
  store: InMemoryStore;
  scheduled: Promise<unknown>[];
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
}

async function setup(depOverrides: Partial<McpServerDeps> = {}, fetchImpl?: typeof fetch): Promise<Harness> {
  const store = new InMemoryStore();
  const scheduled: Promise<unknown>[] = [];
  const fetchMock = vi.fn<typeof fetch>(fetchImpl ?? (async () => anthropicResponse(goodCandidate())));

  const deps: McpServerDeps = {
    store,
    interviewProtocol: "PROTOCOL",
    styleGuides: { af: "AF", en: "EN style guide" },
    postIndex: [],
    now: () => new Date(NOW),
    waitUntil: (promise) => {
      scheduled.push(promise);
    },
    buildUploadLink: (draftId) => `https://cms.example/upload?draft=${draftId}&sig=stub-${draftId}`,
    translation: {
      promptTemplate: "STYLE:{{STYLE_GUIDE}}\nSOURCE:{{SOURCE_JSON}}",
      apiKey: "test-key",
      model: "claude-test",
      fetch: fetchMock,
    },
    ...depOverrides,
  };

  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, store, scheduled, fetchMock };
}

interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...value };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  return { content, structuredContent: toRecord(result.structuredContent), isError: result.isError === true };
}

function textOf(result: ToolResult): string {
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

describe("MCP photo + translation tools", () => {
  it("generate_translation returns the 'vertaling word gemaak' message immediately, before the job completes", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client, store, scheduled } = await setup({}, async () => {
      await gate;
      return anthropicResponse(goodCandidate());
    });
    await store.put(draft());

    const started = await call(client, "generate_translation", { draftId: "d-9" });
    expect(started.isError).toBe(false);
    expect(textOf(started)).toContain("vertaling word gemaak");

    // The job is gated on the (mock) API call, so it cannot have finished yet.
    const midway = await call(client, "check_translation_status", { draftId: "d-9" });
    expect(midway.structuredContent?.status).not.toBe("passing");

    release();
    await Promise.all(scheduled);

    const done = await call(client, "check_translation_status", { draftId: "d-9" });
    expect(done.structuredContent?.status).toBe("passing");
    expect(textOf(done).toLowerCase()).toContain("geslaag");
  });

  it("generate_translation reports an Afrikaans error for an unknown draft", async () => {
    const { client } = await setup();
    const result = await call(client, "generate_translation", { draftId: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("konsep");
  });

  it("check_translation_status reflects a stored failing job state", async () => {
    const { client, store } = await setup();
    await store.setJob("d-9", {
      status: "failing",
      sourceHash: "abc123",
      attempts: 4,
      completedAt: NOW,
      issues: ["empty title", "id mismatch"],
      translation: null,
    });

    const result = await call(client, "check_translation_status", { draftId: "d-9" });
    expect(result.structuredContent?.status).toBe("failing");
    const text = textOf(result);
    expect(text).toContain("Joshua");
    expect(JSON.stringify(result.structuredContent?.issues)).toContain("empty title");
  });

  it("check_translation_status reports when no translation has been requested", async () => {
    const { client } = await setup();
    const result = await call(client, "check_translation_status", { draftId: "d-9" });
    expect(result.structuredContent?.status).toBe("none");
  });

  it("request_photo_upload returns a link carrying the draft id and signature", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    const result = await call(client, "request_photo_upload", { draftId: "d-9" });
    expect(result.isError).toBe(false);
    const url = result.structuredContent?.url;
    expect(typeof url).toBe("string");
    expect(String(url)).toContain("d-9");
    expect(String(url)).toContain("sig=");
    expect(textOf(result)).toContain("https://cms.example/upload");
  });

  it("check_uploads returns the staged-file manifest from the store", async () => {
    const { client, store } = await setup();
    await store.setUploadManifest("d-9", {
      files: [
        { filename: "hero.jpg", size: 1234 },
        { filename: "step-1.jpg", size: 5678 },
      ],
    });

    const result = await call(client, "check_uploads", { draftId: "d-9" });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.structuredContent)).toContain("hero.jpg");
    expect(textOf(result)).toContain("2");
  });

  it("check_uploads reports when nothing has been uploaded yet", async () => {
    const { client } = await setup();
    const result = await call(client, "check_uploads", { draftId: "d-9" });
    expect(result.isError).toBe(false);
    expect(textOf(result).toLowerCase()).toContain("geen");
  });
});
