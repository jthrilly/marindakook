/// <reference types="vite/client" />
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import interviewProtocol from "../prompts/interview-af.md?raw";
import { GitHubError } from "../src/core/github";
import { InMemoryStore } from "../src/core/store";
import type { StoredDraft } from "../src/core/store";
import { createMcpServer, type McpServerDeps } from "../src/mcp/server";

const STYLE = { af: "AF", en: "EN" };

function baseDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  return {
    store: new InMemoryStore(),
    interviewProtocol,
    styleGuides: STYLE,
    translatePrompt: "TRANSLATE PROMPT",
    postIndex: [],
    now: () => new Date("2026-07-20T09:00:00.000Z"),
    createDraftId: () => "d-toets",
    ...overrides,
  };
}

async function connect(deps: McpServerDeps): Promise<Client> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "toets", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// D4 forward note: begin_draft must return the REAL interview protocol text
// (D4's own test used a fixture; this asserts the committed file flows end to
// end through createMcpServer to the tool response).
describe("begin_draft returns the real interview protocol", () => {
  it("includes the authoritative front-page question", async () => {
    const client = await connect(baseDeps());
    const result = await client.callTool({ name: "begin_draft", arguments: {} });
    expect(textOf(result)).toContain("Moet hierdie resep op die voorblad wys?");
  });
});

class FailingListStore extends InMemoryStore {
  constructor(private readonly error: Error) {
    super();
  }
  override async list(): Promise<StoredDraft[]> {
    throw this.error;
  }
}

// D6 forward note: a raw GitHubError thrown from a tool must be wrapped in the
// Afrikaans taxonomy at this layer (never leaked as an English string), and a
// terminal fault must alert Joshua.
describe("guardToolThrows wraps a thrown GitHubError in Afrikaans", () => {
  it("terminal (403): honest Joshua message + a fired alert", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const client = await connect(
      baseDeps({
        store: new FailingListStore(new GitHubError("forbidden", { status: 403 })),
        alert: { webhookUrl: "https://alerts.example/joshua", fetch: fetchMock },
      }),
    );
    const result = await client.callTool({ name: "list_drafts", arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("sê asseblief vir Joshua");
    expect(text).toContain("GH-AUTH");
    expect(text).not.toContain("forbidden");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("terminal (exhausted 5xx retries): honest Joshua message + a fired alert", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const client = await connect(
      baseDeps({
        store: new FailingListStore(
          new GitHubError("upstream", { status: 503, retriesExhausted: true }),
        ),
        alert: { webhookUrl: "https://alerts.example/joshua", fetch: fetchMock },
      }),
    );
    const result = await client.callTool({ name: "list_drafts", arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("sê asseblief vir Joshua");
    expect(text).toContain("GH-5XX");
    expect(text).not.toContain("upstream");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("transient (5xx): retry message, no alert", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const client = await connect(
      baseDeps({
        store: new FailingListStore(new GitHubError("upstream", { status: 500 })),
        alert: { webhookUrl: "https://alerts.example/joshua", fetch: fetchMock },
      }),
    );
    const result = await client.callTool({ name: "list_drafts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("probeer");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
