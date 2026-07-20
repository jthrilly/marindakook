import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import type { Post } from "@site/lib/content-schema";
import type { PostSummary } from "@site/lib/content-derive";
import { InMemoryStore } from "../src/core/store";
import type { GitHubClient } from "../src/core/github";
import { buildTranslationSource } from "../src/core/translation-job";
import { createMcpServer, type ContentSource, type McpServerDeps, type PublishConfig } from "../src/mcp/server";

const NOW = "2026-07-20T09:00:00.000Z";

// The injected taxonomy: the "featured" bookkeeping term (resolved by slug) plus
// a normal recipe category. featuredTermId resolves to 366.
const TERMS = [
  { id: 366, name: "Featured", slug: "featured" },
  { id: 12, name: "Nagereg", slug: "nagereg" },
];

// A live post that already sits in the featured grid (its categories carry 366).
function featuredPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 500,
    slug: "melktert",
    title: "Melktert",
    date: "2020-01-01T10:00:00",
    modified: "2020-01-01T10:00:00",
    excerpt: "Klassieke melktert",
    categories: [12, 366],
    tags: [],
    featured: null,
    commentStatus: "open",
    seo: { title: "Melktert - Marinda Kook", description: null },
    html: "<p>Roer die vulsel</p>",
    recipe: null,
    comments: [],
    ...overrides,
  };
}

interface GitHubCalls {
  commits: { files: { path: string; content: string }[] }[];
}

function makeGitHub(): { github: GitHubClient; calls: GitHubCalls } {
  const calls: GitHubCalls = { commits: [] };
  const github: GitHubClient = {
    async getBaseTree() {
      return { treeSha: "base-tree", commitSha: "base-commit" };
    },
    async pathExists() {
      return { exists: false };
    },
    async findDraftCommit() {
      return null;
    },
    async commitFiles(input) {
      calls.commits.push({ files: input.files.map((f) => ({ path: f.path, content: f.content })) });
      return { commitSha: "new-commit-sha", superseded: false };
    },
    async createBranch() {
      // not used in direct mode
    },
    async openPullRequest() {
      return { number: 1, url: "https://github.com/marinda/site/pull/1" };
    },
    async findOpenPullRequest() {
      return null;
    },
    async latestRunForSha() {
      return null;
    },
  };
  return { github, calls };
}

const INDEX: PostSummary[] = [];

function contentSource(post: Post): ContentSource {
  return {
    loadPost: async (slug) => (slug === post.slug ? post : null),
    loadPage: async () => null,
    loadSite: async () => {
      throw new Error("not needed");
    },
    pageSlugs: [],
  };
}

interface Harness {
  client: Client;
  store: InMemoryStore;
}

async function setup(post: Post, github: GitHubClient): Promise<Harness> {
  const store = new InMemoryStore();
  const publishing: PublishConfig = {
    github,
    pilotMode: false,
    siteBaseUrl: "https://marindakook.co.za",
    reviewer: "Joshua",
  };
  const deps: McpServerDeps = {
    store,
    interviewProtocol: "PROTOCOL",
    styleGuides: { af: "AF", en: "EN" },
    postIndex: INDEX,
    now: () => new Date(NOW),
    createDraftId: () => "d-edit",
    categories: TERMS,
    content: contentSource(post),
    publishing,
  };
  const server = createMcpServer(deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, store };
}

interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const sc = result.structuredContent;
  const structured = sc !== null && typeof sc === "object" && !Array.isArray(sc) ? { ...sc } : undefined;
  return { content, structuredContent: structured, isError: result.isError === true };
}

// Stamp a current passing translation for the draft's CURRENT state (read back so
// the source hash matches after any edit) so the publish translation gate opens.
async function setPassingJob(store: InMemoryStore, draftId: string): Promise<void> {
  const stored = await store.get(draftId);
  if (stored === null || stored.draft.kind !== "post") {
    throw new Error("expected a post draft");
  }
  const draft = stored.draft;
  const hash = sourceHashOf(buildTranslationSource(draft));
  await store.setJob(draftId, {
    status: "passing",
    sourceHash: hash,
    attempts: 1,
    completedAt: NOW,
    translation: {
      id: draft.draftId,
      slug: draft.slug ?? draft.draftId,
      sourceHash: hash,
      title: "Milk tart",
      excerpt: "Classic milk tart",
      seo: { title: "Milk tart - Marinda Kook", description: null },
      html: "<p>Stir the filling</p>",
    },
  });
}

async function approveCurrent(store: InMemoryStore, draftId: string): Promise<void> {
  const stored = await store.get(draftId);
  if (stored === null) {
    throw new Error("draft missing");
  }
  await store.setApproval(draftId, { revision: stored.revision, approvedAt: NOW });
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

// Reads a `number[]` field off a parsed-JSON `unknown` without an `as` cast:
// narrows via real type guards and throws a clear test-failure message on any
// shape mismatch instead of asserting the shape away.
function numberArrayField(value: unknown, field: string): number[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected an object with a «${field}» field`);
  }
  const raw = Reflect.get(value, field);
  if (!isNumberArray(raw)) {
    throw new Error(`expected «${field}» to be a number array`);
  }
  return raw;
}

function publishedCategories(calls: GitHubCalls): number[] {
  const postFile = calls.commits[0]?.files.find((f) => f.path === "content/posts/melktert.json");
  if (postFile === undefined) {
    throw new Error("expected the post JSON in the commit");
  }
  const parsed: unknown = JSON.parse(postFile.content);
  return numberArrayField(parsed, "categories");
}

describe("edit preserves featured membership", () => {
  it("keeps the featured term when a previously-featured post is loaded and republished unchanged", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup(featuredPost(), github);

    const opened = await call(client, "get_post", { slug: "melktert" });
    expect(opened.isError).toBe(false);
    expect(opened.structuredContent?.draftId).toBe("d-edit");

    await setPassingJob(store, "d-edit");
    await approveCurrent(store, "d-edit");

    const published = await call(client, "publish", { draftId: "d-edit" });
    expect(published.isError).toBe(false);

    const categories = publishedCategories(calls);
    expect(categories).toContain(366);
    expect(categories).toContain(12);
  });

  it("removes the featured term when update_post sets featured=false before publishing", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup(featuredPost(), github);

    await call(client, "get_post", { slug: "melktert" });

    const edited = await call(client, "update_post", { draftId: "d-edit", featured: false });
    expect(edited.isError).toBe(false);

    // update_post invalidates any prior translation; re-stamp for the new state.
    await setPassingJob(store, "d-edit");
    await approveCurrent(store, "d-edit");

    const published = await call(client, "publish", { draftId: "d-edit" });
    expect(published.isError).toBe(false);

    const categories = publishedCategories(calls);
    expect(categories).not.toContain(366);
    expect(categories).toContain(12);
  });
});
