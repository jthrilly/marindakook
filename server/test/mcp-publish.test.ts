import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import { postSchema, translationSchema } from "@site/lib/content-schema";
import { compareTranslation } from "@site/lib/translation-check.mjs";
import type { Post, Site } from "@site/lib/content-schema";
import type { PostSummary } from "@site/lib/content-derive";
import { InMemoryStore } from "../src/core/store";
import { GitHubError, type GitHubClient, type PullRequestResult } from "../src/core/github";
import type { DraftPost } from "../src/core/draft-schema";
import { buildTranslationSource } from "../src/core/translation-job";
import { createMcpServer, type ContentSource, type McpServerDeps, type PublishConfig } from "../src/mcp/server";

const NOW = "2026-07-20T09:00:00.000Z";

function fullDraft(overrides: Partial<DraftPost> = {}): DraftPost {
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
    recipe: { style: "default", title: "Melktert", ingredientGroups: [{ items: ["melk"] }] },
    interview: { settled: ["title", "recipe", "story", "featured", "photo"], pending: [], featured: true, heroPhoto: "hero.jpg" },
    ...overrides,
  };
}

function passingTranslation(draft: DraftPost) {
  const hash = sourceHashOf(buildTranslationSource(draft));
  return {
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
  };
}

interface GitHubCalls {
  commits: { branch?: string; files: { path: string; content: string }[]; deletions?: string[]; message: string; draftId: string; requireAbsent?: string[]; expectShas?: Record<string, string> }[];
  branches: { name: string; fromSha: string }[];
  prs: { title: string; head: string; base: string; body?: string }[];
}

interface FakeGitHubOptions {
  findDraftCommit?: (draftId: string) => string | null;
  latestRun?: () => { status: string; conclusion: string | null; url: string } | null;
  pathSha?: string;
  // Simulate GitHub answering the PR-create with a 422 "duplicate PR" (the case
  // a retry hits after a dropped openPullRequest response).
  openPrThrows422?: boolean;
  // What findOpenPullRequest resolves for a head (defaults to whatever a prior
  // openPullRequest registered).
  findOpenPr?: (head: string) => PullRequestResult | null;
}

function makeGitHub(options: FakeGitHubOptions = {}): { github: GitHubClient; calls: GitHubCalls } {
  const calls: GitHubCalls = { commits: [], branches: [], prs: [] };
  const openedPrs = new Map<string, PullRequestResult>();
  let prCounter = 0;
  const github: GitHubClient = {
    async getBaseTree() {
      return { treeSha: "base-tree", commitSha: "base-commit" };
    },
    async pathExists() {
      return options.pathSha !== undefined ? { exists: true, sha: options.pathSha } : { exists: false };
    },
    async findDraftCommit(draftId) {
      return options.findDraftCommit ? options.findDraftCommit(draftId) : null;
    },
    async commitFiles(input) {
      calls.commits.push({
        branch: input.branch,
        files: input.files.map((f) => ({ path: f.path, content: f.content })),
        deletions: input.deletions,
        message: input.message,
        draftId: input.draftId,
        requireAbsent: input.requireAbsent,
        expectShas: input.expectShas,
      });
      return { commitSha: "new-commit-sha", superseded: false };
    },
    async createBranch(name, fromSha) {
      calls.branches.push({ name, fromSha });
    },
    async openPullRequest(input) {
      if (options.openPrThrows422 === true) {
        throw new GitHubError(`A pull request already exists for marinda:${input.head}`, { status: 422 });
      }
      prCounter += 1;
      calls.prs.push({ title: input.title, head: input.head, base: input.base, body: input.body });
      const result = { number: prCounter, url: `https://github.com/marinda/site/pull/${prCounter}` };
      openedPrs.set(input.head, result);
      return result;
    },
    async findOpenPullRequest(head) {
      if (options.findOpenPr) {
        return options.findOpenPr(head);
      }
      return openedPrs.get(head) ?? null;
    },
    async latestRunForSha() {
      return options.latestRun ? options.latestRun() : null;
    },
  };
  return { github, calls };
}

function fixturePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 500,
    slug: "melktert",
    title: "Melktert",
    date: "2020-01-01T10:00:00",
    modified: "2020-01-01T10:00:00",
    excerpt: "Oud",
    categories: [12],
    tags: [],
    featured: null,
    commentStatus: "open",
    seo: { title: "Melktert - Marinda Kook", description: null },
    html: "<p>oud</p>",
    recipe: null,
    comments: [{ id: 1, parent: 0, author: "Jan", avatar: null, date: "2020-02-01T10:00:00", html: "<p>Lekker</p>" }],
    ...overrides,
  };
}

const SITE: Site = {
  name: "Marinda Kook",
  tagline: "Maklike Suid-Afrikaanse resepte",
  logo: null,
  nav: { top: [{ label: "Tuis", path: "/" }], main: [{ label: "Resepte", path: "/resepte/" }] },
  social: [],
  bio: { name: "Marinda", about: "Oor my teks", photo: null, button: { label: "Meer", path: "/oor-my/" } },
  sidebar: {
    tabs: { views: "Gewildste", comments: "Kommentaar" },
    popularViews: [],
    popularComments: [],
    featurePosts: { title: "Nuwe Resepte", count: 3 },
    socialWidget: { title: "Gesels saam", description: "Volg my" },
    categoriesWidget: { title: "Kategorieë" },
  },
  home: { sectionTitle: "Nuutste Resepte", featuredCategory: "featured", readMore: "Lees Meer" },
  newsletter: { heading: "Nuusbrief", placeholder: "E-pos", button: "Teken in", action: "https://example.com" },
  postsPerPage: 12,
};

function contentSource(overrides: Partial<ContentSource> = {}): ContentSource {
  return {
    loadPost: async () => null,
    loadPage: async () => null,
    loadSite: async () => SITE,
    pageSlugs: ["oor-my", "optredes"],
    ...overrides,
  };
}

const INDEX: PostSummary[] = [
  { id: 100, slug: "piesangbrood", title: "Piesangbrood", date: "2021-01-01T00:00:00", excerpt: "", categories: [12], tags: [], featured: null, hasRecipe: true, commentCount: 0 },
];

interface Harness {
  client: Client;
  store: InMemoryStore;
}

async function setup(opts: {
  github: GitHubClient;
  content?: ContentSource;
  pilotMode?: boolean;
} & Partial<McpServerDeps> = { github: makeGitHub().github }): Promise<Harness> {
  const store = new InMemoryStore();
  const publishing: PublishConfig = {
    github: opts.github,
    pilotMode: opts.pilotMode ?? false,
    siteBaseUrl: "https://marindakook.co.za",
    reviewer: "Joshua",
  };
  const deps: McpServerDeps = {
    store,
    interviewProtocol: "PROTOCOL",
    styleGuides: { af: "AF", en: "EN" },
    postIndex: INDEX,
    now: opts.now ?? (() => new Date(NOW)),
    categories: opts.categories,
    content: opts.content ?? contentSource(),
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

function textOf(result: ToolResult): string {
  return result.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

async function approve(store: InMemoryStore, draft: DraftPost): Promise<void> {
  const put = await store.put(draft);
  await store.setApproval(draft.draftId, { revision: put.revision, approvedAt: NOW });
}

describe("publish approval gate", () => {
  it("refuses in Afrikaans when the preview is not approved for the current revision", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    await store.put(fullDraft());
    await store.setJob("d-1", passingTranslation(fullDraft()));

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("die voorskou is nog nie goedgekeur nie");
    expect(calls.commits).toHaveLength(0);
  });

  it("refuses once the content changes after approval (approval is revision-keyed)", async () => {
    const { github } = makeGitHub();
    const { client, store } = await setup({ github });
    await approve(store, fullDraft());
    await store.setJob("d-1", passingTranslation(fullDraft()));
    // Content edit after approval invalidates the stored approval.
    await store.put(fullDraft({ title: "Melktert (nuut)" }));

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("nog nie goedgekeur");
  });
});

describe("publish completeness gate", () => {
  it("refuses and names the missing field when the Post is incomplete", async () => {
    const { github, calls } = makeGitHub();
    const incomplete = fullDraft({ html: undefined });
    const { client, store } = await setup({ github });
    await approve(store, incomplete);
    await store.setJob("d-1", passingTranslation(incomplete));

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("«html»");
    expect(calls.commits).toHaveLength(0);
  });
});

describe("publish translation gate", () => {
  it("refuses when there is no current passing translation", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    await approve(store, fullDraft());

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("vertaling");
    expect(calls.commits).toHaveLength(0);
  });
});

describe("publish (pilot off)", () => {
  it("commits create-only with the draft-id and returns the live-URL message", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));
    await store.putPhoto("d-1", "hero.jpg", new Uint8Array([1, 2, 3]), { contentType: "image/jpeg", uploadedAt: NOW });

    const result = await call(client, "publish", { draftId: "d-1" });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("https://marindakook.co.za/melktert/");
    expect(calls.commits).toHaveLength(1);
    const commit = calls.commits[0];
    expect(commit.draftId).toBe("d-1");
    expect(commit.requireAbsent).toEqual(["content/posts/melktert.json"]);
    const paths = commit.files.map((f) => f.path);
    expect(paths).toContain("content/posts/melktert.json");
    expect(paths).toContain("content/translations/en/posts/melktert.json");
    expect(paths).toContain("public/media/uploads/2026/07/hero.jpg");
    // Staged photo removed only after git confirmed success.
    expect(await store.listPhotos("d-1")).toHaveLength(0);
  });

  it("writes committed JSON as JSON.stringify(data, null, 1) with no trailing newline", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));

    await call(client, "publish", { draftId: "d-1" });

    const postFile = calls.commits[0].files.find((f) => f.path === "content/posts/melktert.json");
    expect(postFile).toBeDefined();
    const content = postFile!.content;
    expect(content.endsWith("\n")).toBe(false);
    expect(content.startsWith("{\n ")).toBe(true);
    expect(content).toBe(JSON.stringify(JSON.parse(content), null, 1));
  });

  it("builds a schema-complete Post: id max+1, closed comments, hero renditions", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));
    await store.putPhoto("d-1", "hero.jpg", new Uint8Array([9]), { contentType: "image/jpeg", uploadedAt: NOW });

    await call(client, "publish", { draftId: "d-1" });

    const postFile = calls.commits[0].files.find((f) => f.path === "content/posts/melktert.json");
    const post: unknown = JSON.parse(postFile!.content);
    if (post === null || typeof post !== "object") throw new Error("bad post");
    const record: Record<string, unknown> = { ...post };
    expect(record.id).toBe(101);
    expect(record.commentStatus).toBe("closed");
    expect(record.comments).toEqual([]);
    expect(record.date).toBe("2026-07-20T09:00:00");
    const featured: unknown = record.featured;
    if (featured === null || typeof featured !== "object") throw new Error("expected featured");
    expect(JSON.stringify(featured)).toContain("/media/uploads/2026/07/hero-760x760.jpg");
    expect(JSON.stringify(featured)).toContain("hero-760x990.jpg");
    expect(JSON.stringify(featured)).toContain("hero-150x150.jpg");
  });
});

// The committed English translation must satisfy THREE consumers at once:
// translationSchema (strict), the sync's compareTranslation against the built POST,
// and CI's sourceHash net (hashed over the POST). The old fixture omitted recipe —
// impossible for a real recipe draft — so it never exercised the contract. These
// build a genuinely-passing recipe candidate and a non-recipe/no-excerpt candidate
// and assert on the file publish actually committed.
function recipeDraft(): DraftPost {
  return fullDraft({
    excerpt: "Klassieke melktert met 'n kaneelbolaag.",
    html: "<p>Roer die vulsel tot dit verdik.</p>",
    seo: { title: "Melktert - Marinda Kook", description: "Die beste melktert." },
    recipe: {
      style: "default",
      title: "Melktert",
      courses: ["Nagereg"],
      summaryHtml: "<p>'n Klassieke Suid-Afrikaanse melktert.</p>",
      ingredientGroups: [{ title: "Vulsel", items: ["500 ml melk", "2 eiers"] }],
      directionGroups: [{ title: "Metode", steps: ["Roer die vulsel", "Bak vir 30 minute"] }],
      notes: ["Bedien koud."],
    },
    interview: {
      settled: ["title", "recipe", "story", "featured", "photo"],
      pending: [],
      featured: true,
      heroPhoto: "hero.jpg",
    },
  });
}

// The model's PASSING candidate: translated text with structure + counts matching
// the draft source. Loose/draft-shaped (no recipe image, sparse) — exactly what a
// real translation job stores.
function passingRecipeJob(draft: DraftPost) {
  const hash = sourceHashOf(buildTranslationSource(draft));
  return {
    status: "passing",
    sourceHash: hash,
    attempts: 1,
    completedAt: NOW,
    translation: {
      id: draft.draftId,
      slug: draft.slug ?? draft.draftId,
      sourceHash: hash,
      title: "Milk tart",
      excerpt: "Classic milk tart with a cinnamon topping.",
      seo: { title: "Milk tart - Marinda Kook", description: "The best milk tart." },
      html: "<p>Stir the filling until it thickens.</p>",
      recipe: {
        style: "default",
        title: "Milk tart",
        courses: ["Dessert"],
        summaryHtml: "<p>A classic South African milk tart.</p>",
        ingredientGroups: [{ title: "Filling", items: ["500 ml milk", "2 eggs"] }],
        directionGroups: [{ title: "Method", steps: ["Stir the filling", "Bake for 30 minutes"] }],
        notes: ["Serve cold."],
      },
    },
  };
}

describe("publish committed-translation contract", () => {
  it("reconciles a recipe translation to the built post (schema + compareTranslation + sourceHash net)", async () => {
    const draft = recipeDraft();
    const job = passingRecipeJob(draft);
    // The stored candidate genuinely passes the validator against the DRAFT source.
    expect(compareTranslation(buildTranslationSource(draft), job.translation)).toEqual([]);

    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    await approve(store, draft);
    await store.setJob("d-1", job);
    await store.putPhoto("d-1", "hero.jpg", new Uint8Array([1, 2, 3]), { contentType: "image/jpeg", uploadedAt: NOW });

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(false);

    const postFile = calls.commits[0].files.find((f) => f.path === "content/posts/melktert.json");
    const translationFile = calls.commits[0].files.find(
      (f) => f.path === "content/translations/en/posts/melktert.json",
    );
    if (postFile === undefined || translationFile === undefined) throw new Error("expected post + translation files");
    const committedPost = postSchema.parse(JSON.parse(postFile.content));
    const rawTranslation: unknown = JSON.parse(translationFile.content);

    // 1. The committed translation is valid against the strict content schema.
    expect(() => translationSchema.parse(rawTranslation)).not.toThrow();
    const committedTranslation = translationSchema.parse(rawTranslation);
    // 2. It reconciles against the committed POST (image/details/counts/tags agree).
    expect(compareTranslation(committedPost, committedTranslation)).toEqual([]);
    // 3. Its sourceHash matches CI's recomputation over the built post.
    expect(committedTranslation.sourceHash).toBe(sourceHashOf(committedPost));
  });

  it("stamps sourceHashOf(post) for a non-recipe post lacking excerpt + seo (excerpt/seo divergence)", async () => {
    const draft = fullDraft({
      title: "My storie",
      slug: "my-storie",
      excerpt: undefined,
      seo: undefined,
      html: "<p>Hallo daar.</p>",
      recipe: undefined,
      interview: { settled: ["title", "story"], pending: [], featured: false },
    });
    const hash = sourceHashOf(buildTranslationSource(draft));
    const job = {
      status: "passing",
      sourceHash: hash,
      attempts: 1,
      completedAt: NOW,
      translation: {
        id: draft.draftId,
        slug: draft.slug ?? draft.draftId,
        sourceHash: hash,
        title: "My story",
        seo: { title: "My story - Marinda Kook", description: null },
        html: "<p>Hello there.</p>",
      },
    };
    expect(compareTranslation(buildTranslationSource(draft), job.translation)).toEqual([]);

    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github });
    await approve(store, draft);
    await store.setJob("d-1", job);

    const result = await call(client, "publish", { draftId: "d-1" });
    expect(result.isError).toBe(false);

    const postFile = calls.commits[0].files.find((f) => f.path === "content/posts/my-storie.json");
    const translationFile = calls.commits[0].files.find(
      (f) => f.path === "content/translations/en/posts/my-storie.json",
    );
    if (postFile === undefined || translationFile === undefined) throw new Error("expected post + translation files");
    const committedPost = postSchema.parse(JSON.parse(postFile.content));
    const rawTranslation: unknown = JSON.parse(translationFile.content);

    expect(() => translationSchema.parse(rawTranslation)).not.toThrow();
    const committedTranslation = translationSchema.parse(rawTranslation);
    // Old code stamped sourceHashOf(draftSource): excerpt omitted (->null) and a
    // partial seo. CI recomputes sourceHashOf(post): excerpt "" and the built seo.
    // They must agree, or the deploy's `npm test` fails on the first real publish.
    expect(committedTranslation.sourceHash).toBe(sourceHashOf(committedPost));
  });
});

describe("publish featured term", () => {
  const TERMS = [
    { id: 366, name: "Featured", slug: "featured" },
    { id: 12, name: "Nagereg", slug: "nagereg" },
  ];

  async function publishedCategories(draft: DraftPost): Promise<number[]> {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github, categories: TERMS });
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));
    await call(client, "publish", { draftId: "d-1" });
    const postFile = calls.commits[0].files.find((f) => f.path === "content/posts/melktert.json");
    const post: unknown = JSON.parse(postFile!.content);
    if (post === null || typeof post !== "object") throw new Error("bad post");
    const categories = (post as { categories: unknown }).categories;
    if (!Array.isArray(categories)) throw new Error("expected categories array");
    return categories as number[];
  }

  it("adds the featured term (resolved by slug) when interview.featured is true", async () => {
    const draft = fullDraft({
      categories: [12],
      interview: { settled: ["featured"], pending: [], featured: true },
    });
    const categories = await publishedCategories(draft);
    expect(categories).toContain(366);
    expect(categories).toContain(12);
  });

  it("excludes the featured term when interview.featured is false (un-featuring an update)", async () => {
    const draft = fullDraft({
      categories: [12, 366],
      interview: { settled: ["featured"], pending: [], featured: false },
    });
    const categories = await publishedCategories(draft);
    expect(categories).not.toContain(366);
    expect(categories).toContain(12);
  });
});

describe("publish media-path determinism", () => {
  async function heroPathFor(now: string): Promise<string> {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github, now: () => new Date(now) });
    const draft = fullDraft({ createdAt: "2026-03-15T08:00:00.000Z" });
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));
    await store.putPhoto("d-1", "hero.jpg", new Uint8Array([1]), { contentType: "image/jpeg", uploadedAt: NOW });
    await call(client, "publish", { draftId: "d-1" });
    const mediaFile = calls.commits[0].files.find((f) => f.path.startsWith("public/media/uploads/"));
    if (mediaFile === undefined) throw new Error("expected a media file");
    return mediaFile.path;
  }

  it("derives the media year/month from the draft's createdAt, not publish-time now", async () => {
    const early = await heroPathFor("2026-11-30T23:00:00.000Z");
    const late = await heroPathFor("2027-05-01T06:00:00.000Z");
    expect(early).toBe(late);
    // Stable path comes from createdAt (2026-03), not either publish-time now.
    expect(early).toBe("public/media/uploads/2026/03/hero.jpg");
  });
});

describe("publish (pilot on)", () => {
  it("opens a PR and returns the 'gestuur vir Joshua' message", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github, pilotMode: true });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));

    const result = await call(client, "publish", { draftId: "d-1" });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("gestuur vir Joshua");
    expect(calls.branches).toHaveLength(1);
    expect(calls.branches[0].name).toBe("cms/publiseer-d-1");
    expect(calls.branches[0].fromSha).toBe("base-commit");
    expect(calls.prs).toHaveLength(1);
    expect(calls.prs[0].head).toBe("cms/publiseer-d-1");
    expect(calls.prs[0].base).toBe("main");
    // The commit lands on the PR branch, not main.
    expect(calls.commits[0].branch).toBe("cms/publiseer-d-1");
  });

  it("a retry after a recorded PR short-circuits to success without a duplicate branch/commit/PR", async () => {
    const { github, calls } = makeGitHub();
    const { client, store } = await setup({ github, pilotMode: true });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));

    // Attempt 1 opens the PR and records it.
    const first = await call(client, "publish", { draftId: "d-1" });
    expect(first.isError).toBe(false);
    const firstUrl = first.structuredContent?.url;
    expect(firstUrl).toBe("https://github.com/marinda/site/pull/1");

    // Attempt 2 (the dropped-response retry): the recorded PR short-circuits.
    const second = await call(client, "publish", { draftId: "d-1" });
    expect(second.isError).toBe(false);
    expect(textOf(second)).toContain("gestuur vir Joshua");
    expect(second.structuredContent?.url).toBe(firstUrl);
    // No duplicate work: still exactly one branch, one commit, one PR.
    expect(calls.branches).toHaveLength(1);
    expect(calls.commits).toHaveLength(1);
    expect(calls.prs).toHaveLength(1);
  });

  it("after the pilot PR is merged to main, a repeated publish reports live — not 'gestuur vir Joshua'", async () => {
    let merged = false;
    const { github, calls } = makeGitHub({ findDraftCommit: () => (merged ? "merged-sha" : null) });
    const { client, store } = await setup({ github, pilotMode: true });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));

    // Attempt 1: opens the PR and records it (nothing on main yet).
    const first = await call(client, "publish", { draftId: "d-1" });
    expect(first.isError).toBe(false);
    expect(textOf(first)).toContain("gestuur vir Joshua");
    expect(calls.prs).toHaveLength(1);

    // Joshua reviews and MERGES the PR: the draft's commit is now on main.
    merged = true;

    // Attempt 2: the merged commit is found on main → live/published success,
    // NOT the stale "gestuur vir Joshua" awaiting-approval message.
    const second = await call(client, "publish", { draftId: "d-1" });
    expect(second.isError).toBe(false);
    expect(textOf(second)).not.toContain("gestuur vir Joshua");
    expect(textOf(second)).toContain("https://marindakook.co.za/melktert/");
    expect(second.structuredContent?.alreadyPublished).toBe(true);
    // The merged-detection path does no duplicate git work.
    expect(calls.prs).toHaveLength(1);
    expect(calls.branches).toHaveLength(1);
    expect(calls.commits).toHaveLength(1);
  });

  it("resolves an already-existing PR when openPullRequest 422s (dropped response), no error surfaced", async () => {
    const { github, calls } = makeGitHub({
      openPrThrows422: true,
      findOpenPr: () => ({ number: 42, url: "https://github.com/marinda/site/pull/42" }),
    });
    const { client, store } = await setup({ github, pilotMode: true });
    const draft = fullDraft();
    await approve(store, draft);
    await store.setJob("d-1", passingTranslation(draft));

    const result = await call(client, "publish", { draftId: "d-1" });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("gestuur vir Joshua");
    expect(textOf(result)).toContain("https://github.com/marinda/site/pull/42");
    // The create was attempted once and threw; no duplicate branch/commit.
    expect(calls.branches).toHaveLength(1);
    expect(calls.commits).toHaveLength(1);
    // The resolved PR is recorded so a later status check/retry is honest.
    const record = await store.getPublish("d-1");
    expect(record).toMatchObject({ mode: "pilot", pr: 42, url: "https://github.com/marinda/site/pull/42" });
  });
});

describe("check_publish_status", () => {
  it("reports 'superseded' for a cancelled run covered by the concurrency group", async () => {
    const { github } = makeGitHub({
      findDraftCommit: () => "landed-sha",
      latestRun: () => ({ status: "completed", conclusion: "cancelled", url: "https://x" }),
    });
    const { client } = await setup({ github });

    const result = await call(client, "check_publish_status", { draftId: "d-1" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.status).toBe("superseded");
    expect(textOf(result)).toContain("Superseded");
  });

  it("reports 'live' with the URL for a successful run", async () => {
    const { github } = makeGitHub({
      findDraftCommit: () => "landed-sha",
      latestRun: () => ({ status: "completed", conclusion: "success", url: "https://x" }),
    });
    const { client, store } = await setup({ github });
    await store.setPublish("d-1", { mode: "direct", commitSha: "landed-sha", slug: "melktert" });

    const result = await call(client, "check_publish_status", { draftId: "d-1" });
    expect(result.structuredContent?.status).toBe("live");
    expect(textOf(result)).toContain("https://marindakook.co.za/melktert/");
  });

  it("reports 'awaiting-review' for an open pilot PR (not yet on main)", async () => {
    const { github } = makeGitHub({ findDraftCommit: () => null });
    const { client, store } = await setup({ github });
    await store.setPublish("d-1", { mode: "pilot", pr: 7, url: "https://github.com/x/pull/7", slug: "melktert" });

    const result = await call(client, "check_publish_status", { draftId: "d-1" });
    expect(result.structuredContent?.status).toBe("awaiting-review");
    expect(textOf(result)).toContain("Joshua");
  });
});

describe("delete_post", () => {
  it("refuses without an explicit confirmation", async () => {
    const { github, calls } = makeGitHub();
    const { client } = await setup({ github, content: contentSource({ loadPost: async () => fixturePost() }) });

    const result = await call(client, "delete_post", { slug: "melktert" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("confirm: true");
    expect(calls.prs).toHaveLength(0);
  });

  it("always routes through a PR (even with pilot mode off) when confirmed", async () => {
    const { github, calls } = makeGitHub({ pathSha: "trsha" });
    const { client } = await setup({
      github,
      pilotMode: false,
      content: contentSource({ loadPost: async () => fixturePost() }),
    });

    const result = await call(client, "delete_post", { slug: "melktert", confirm: true });
    expect(result.isError).toBe(false);
    expect(calls.branches).toHaveLength(1);
    expect(calls.branches[0].name).toBe("cms/verwyder-melktert");
    expect(calls.prs).toHaveLength(1);
    expect(calls.commits).toHaveLength(1);
    expect(calls.commits[0].deletions).toEqual([
      "content/posts/melktert.json",
      "content/translations/en/posts/melktert.json",
    ]);
    expect(calls.commits[0].files).toHaveLength(0);
  });
});

describe("update_post", () => {
  it("marks the translation stale and bumps the draft timestamp", async () => {
    const { github } = makeGitHub();
    // An older updatedAt so the bump to publish-time is observable under the
    // fixed test clock.
    const draft = fullDraft({ updatedAt: "2026-07-01T00:00:00.000Z" });
    const { client, store } = await setup({ github, content: contentSource({ loadPost: async () => fixturePost() }) });
    await store.put(draft);
    await store.setJob("d-1", passingTranslation(draft));
    expect(await store.getJob("d-1")).not.toBeNull();

    const result = await call(client, "update_post", { draftId: "d-1", html: "<p>Nuwe metode</p>" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.translationStale).toBe(true);

    // Translation job cleared; a fresh translation is required before publish.
    expect(await store.getJob("d-1")).toBeNull();
    const after = await store.get("d-1");
    expect(after?.draft.updatedAt).toBe(NOW);
    if (after?.draft.kind === "post") {
      expect(after.draft.html).toBe("<p>Nuwe metode</p>");
    }
  });
});
