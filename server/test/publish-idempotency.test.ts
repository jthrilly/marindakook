import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import type { PostSummary } from "@site/lib/content-derive";
import { InMemoryStore } from "../src/core/store";
import { GitHubError, type GitHubClient } from "../src/core/github";
import type { DraftPost } from "../src/core/draft-schema";
import { buildTranslationSource } from "../src/core/translation-job";
import { createMcpServer, type ContentSource, type McpServerDeps } from "../src/mcp/server";

const NOW = "2026-07-20T09:00:00.000Z";

function draft(): DraftPost {
  return {
    draftId: "d-1",
    kind: "post",
    createdAt: NOW,
    updatedAt: NOW,
    title: "Melktert",
    slug: "melktert",
    excerpt: "Klassieke melktert",
    categories: [12],
    tags: [],
    html: "<p>Roer die vulsel</p>",
    seo: { title: "Melktert - Marinda Kook", description: null },
    interview: { settled: [], pending: [], featured: false },
  };
}

function passingJob(d: DraftPost) {
  const hash = sourceHashOf(buildTranslationSource(d));
  return {
    status: "passing",
    sourceHash: hash,
    attempts: 1,
    completedAt: NOW,
    translation: {
      id: d.draftId,
      slug: d.slug ?? d.draftId,
      sourceHash: hash,
      title: "Milk tart",
      seo: { title: "Milk tart - Marinda Kook", description: null },
      html: "<p>Stir</p>",
    },
  };
}

const INDEX: PostSummary[] = [];

const content: ContentSource = {
  loadPost: async () => null,
  loadPage: async () => null,
  loadSite: async () => {
    throw new Error("not needed");
  },
  pageSlugs: [],
};

async function newClient(github: GitHubClient): Promise<{ client: Client; store: InMemoryStore }> {
  const store = new InMemoryStore();
  const deps: McpServerDeps = {
    store,
    interviewProtocol: "P",
    styleGuides: { af: "AF", en: "EN" },
    postIndex: INDEX,
    now: () => new Date(NOW),
    content,
    publishing: { github, pilotMode: false, siteBaseUrl: "https://marindakook.co.za", reviewer: "Joshua" },
  };
  const server = createMcpServer(deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, store };
}

async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  return { text, isError: result.isError === true };
}

describe("publish idempotency (git as authority)", () => {
  it("a retry after a landed-but-dropped commit reports success and never double-commits", async () => {
    let landed = false;
    let commitCount = 0;
    const github: GitHubClient = {
      async getBaseTree() {
        return { treeSha: "t", commitSha: "c" };
      },
      async pathExists() {
        return { exists: false };
      },
      async findDraftCommit() {
        return landed ? "landed-sha" : null;
      },
      async commitFiles() {
        commitCount += 1;
        // The commit reaches GitHub, then the response is dropped.
        landed = true;
        throw new GitHubError("network dropped after the commit landed");
      },
      async createBranch() {
        // not used in direct mode
      },
      async openPullRequest() {
        return { number: 1, url: "https://x/pull/1" };
      },
      async latestRunForSha() {
        return null;
      },
    };

    const { client, store } = await newClient(github);
    const d = draft();
    const put = await store.put(d);
    await store.setApproval("d-1", { revision: put.revision, approvedAt: NOW });
    await store.setJob("d-1", passingJob(d));
    await store.putPhoto("d-1", "hero.jpg", new Uint8Array([1]), { contentType: "image/jpeg", uploadedAt: NOW });

    // Attempt 1: the commit lands but the client sees an error.
    const first = await callText(client, "publish", { draftId: "d-1" });
    expect(first.isError).toBe(true);
    expect(commitCount).toBe(1);
    // Photos are NOT deleted while the git state is unconfirmed.
    expect(await store.listPhotos("d-1")).toHaveLength(1);

    // Attempt 2: findDraftCommit now sees the landed commit → success, no re-commit.
    const second = await callText(client, "publish", { draftId: "d-1" });
    expect(second.isError).toBe(false);
    expect(second.text).toContain("https://marindakook.co.za/melktert/");
    expect(commitCount).toBe(1);
    // Now git confirms success, so the staged photos are cleaned up.
    expect(await store.listPhotos("d-1")).toHaveLength(0);
  });
});
