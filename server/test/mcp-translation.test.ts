import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
// The real committed prompt + EN style guide are served verbatim to the chat
// model by request_translation, so the integration test injects the real files
// (via Vite's `?raw`) rather than fixtures — asserting they flow through in full.
import translatePrompt from "../prompts/translate-en.md?raw";
import styleGuideEn from "../../content/style-guide.en.md?raw";
import { InMemoryStore } from "../src/core/store";
import type { DraftPost } from "../src/core/draft-schema";
import { parseJobRecord } from "../src/core/translation-job";
import { createMcpServer, type McpServerDeps } from "../src/mcp/server";
import { renderPreviewPage, type PreviewDeps } from "../src/pages/preview";

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

function goodTranslation(): Record<string, unknown> {
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

// Wrong id + empty title: compareTranslation flags both, so submit_translation
// must reject this and store no passing record.
function badTranslation(): Record<string, unknown> {
  return { id: "wrong", slug: "melktert", sourceHash: "", title: "", seo: { title: "" }, html: "<p>x</p>" };
}

interface Harness {
  client: Client;
  store: InMemoryStore;
}

async function setup(depOverrides: Partial<McpServerDeps> = {}): Promise<Harness> {
  const store = new InMemoryStore();
  const deps: McpServerDeps = {
    store,
    interviewProtocol: "PROTOCOL",
    styleGuides: { af: "AF", en: styleGuideEn },
    translatePrompt,
    postIndex: [],
    now: () => new Date(NOW),
    buildUploadLink: (draftId) => `https://cms.example/upload?draft=${draftId}&sig=stub-${draftId}`,
    ...depOverrides,
  };

  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, store };
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

function previewDeps(store: InMemoryStore): PreviewDeps {
  return { store, verifyLink: () => ({ draftId: "d-9" }), now: () => new Date(NOW) };
}

describe("MCP photo + translation tools", () => {
  it("request_translation returns the Afrikaans source, the full prompt, and the EN style guide to the model", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    const result = await call(client, "request_translation", { draftId: "d-9" });
    expect(result.isError).toBe(false);
    const text = textOf(result);
    // The Afrikaans source object (its title) is embedded.
    expect(text).toContain("Melktert");
    // The full translate prompt (a distinctive contract heading) is present, untruncated.
    expect(text).toContain("Output contract");
    expect(text).toContain("Terminology anchors");
    // The EN style guide is present.
    expect(text).toContain("Marinda's voice — style guide (English)");
    // And it tells the model to submit via submit_translation.
    expect(text).toContain("submit_translation");
  });

  it("request_translation reports an Afrikaans error for an unknown draft", async () => {
    const { client } = await setup();
    const result = await call(client, "request_translation", { draftId: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("konsep");
  });

  it("submit_translation stores a passing record on a good translation, and preview then shows the English side", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    const result = await call(client, "submit_translation", { draftId: "d-9", translation: goodTranslation() });
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("✓");
    expect(result.structuredContent?.status).toBe("passing");

    // Stored in the shape preview + publish read.
    expect(parseJobRecord(await store.getJob("d-9"))?.status).toBe("passing");

    // Downstream: the preview page now renders the English translation.
    const html = await (await renderPreviewPage("d-9", previewDeps(store))).text();
    expect(html).toContain("Milk tart");
  });

  it("submit_translation accepts the translation sent as a JSON string (real MCP client) and stores a passing record", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    // A real Claude MCP client serialises the structured `translation` object as a
    // JSON STRING because the field is advertised as z.unknown() (no JSON-schema type).
    const result = await call(client, "submit_translation", {
      draftId: "d-9",
      translation: JSON.stringify(goodTranslation()),
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.status).toBe("passing");
    expect(parseJobRecord(await store.getJob("d-9"))?.status).toBe("passing");
  });

  it("submit_translation returns the Afrikaans issues and does NOT store a passing record on a bad translation", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    const result = await call(client, "submit_translation", { draftId: "d-9", translation: badTranslation() });
    expect(result.isError).toBe(false);
    const text = textOf(result);
    expect(text.toLowerCase()).toContain("probleme");
    expect(text.toLowerCase()).toContain("stuur weer");
    expect(result.structuredContent?.status).toBe("failing");

    // No passing record: publish's gate must not treat this as a passing translation.
    expect(parseJobRecord(await store.getJob("d-9"))?.status).not.toBe("passing");

    // And the preview page does not show an English side.
    const html = await (await renderPreviewPage("d-9", previewDeps(store))).text();
    expect(html).not.toContain("Milk tart");
  });

  it("request -> submit-bad -> submit-good ends in a passing record (the in-conversation retry loop)", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    await call(client, "request_translation", { draftId: "d-9" });
    const bad = await call(client, "submit_translation", { draftId: "d-9", translation: badTranslation() });
    expect(bad.structuredContent?.status).toBe("failing");

    const good = await call(client, "submit_translation", { draftId: "d-9", translation: goodTranslation() });
    expect(good.structuredContent?.status).toBe("passing");
    expect(parseJobRecord(await store.getJob("d-9"))?.status).toBe("passing");
  });

  it("submit_translation rejects a non-object translation with an Afrikaans hint", async () => {
    const { client, store } = await setup();
    await store.put(draft());

    const result = await call(client, "submit_translation", { draftId: "d-9", translation: "not json" });
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("json-objek");
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
