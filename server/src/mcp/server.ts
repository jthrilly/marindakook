import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostSummary } from "@site/lib/content-derive";
import type { Page, Post, Site } from "@site/lib/content-schema";
import type { GitHubClient } from "../core/github";
import type { DraftStore } from "../core/store";
import { registerDraftTools } from "./tools/drafts";
import { registerEditTools } from "./tools/edit";
import { registerChromeTools } from "./tools/chrome";
import { registerPhotoTools } from "./tools/photos";
import { registerPublishTools } from "./tools/publish";
import { registerTranslationTools } from "./tools/translation";
import { registerVoiceTools } from "./tools/voice";

// The async-translation job's runtime configuration (env-provided). Injected so
// tests can supply a mocked fetch and D9 can wire the real Anthropic secret.
export interface TranslationConfig {
  promptTemplate: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

// A category the interview may offer Marinda. The Worker (or a test) supplies
// the full term list; the internal bookkeeping terms are stripped here so they
// can never be offered as real choices.
export interface CategoryOption {
  id: number;
  name: string;
  slug: string;
  parent?: number;
}

// Reads committed content the edit/chrome/publish tools need to see (an existing
// post to update, the live site chrome, the page slugs reserved against new
// posts). Injected so tests pass fixtures and the Worker reads bundled/committed
// JSON. Separate from `publishing` so a read-only edit works without a git client.
export interface ContentSource {
  loadPost: (slug: string) => Post | null | Promise<Post | null>;
  loadPage: (slug: string) => Page | null | Promise<Page | null>;
  loadSite: () => Site | Promise<Site>;
  pageSlugs: string[];
}

// Everything `publish`/`delete_post`/`check_publish_status` need to write to git.
// `pilotMode` on → publishes open a PR for Joshua instead of committing to main.
export interface PublishConfig {
  github: GitHubClient;
  pilotMode: boolean;
  baseBranch?: string;
  siteBaseUrl: string;
  reviewer?: string;
}

// Everything the MCP layer needs, injected so tests can supply fixtures (an
// in-memory store, a small post index, the protocol/style-guide texts) instead
// of the bundled Worker assets. `postIndex` may be a value or a loader so the
// real Worker can derive it lazily from committed content.
export interface McpServerDeps {
  store: DraftStore;
  interviewProtocol: string;
  styleGuides: { af: string; en: string };
  postIndex: PostSummary[] | (() => PostSummary[] | Promise<PostSummary[]>);
  categories?: CategoryOption[];
  now?: () => Date;
  createDraftId?: () => string;
  // Keeps a background job alive past a tool's return (the Worker passes the
  // request's ExecutionContext.waitUntil; D9). Absent in non-translation tests.
  waitUntil?: (promise: Promise<unknown>) => void;
  // Builds the signed upload-page link for a draft. The real signer lands in
  // D9; tests inject a stub. Absent means request_photo_upload is unavailable.
  buildUploadLink?: (draftId: string) => string | Promise<string>;
  translation?: TranslationConfig;
  content?: ContentSource;
  publishing?: PublishConfig;
}

export interface ToolContext {
  store: DraftStore;
  interviewProtocol: string;
  styleGuides: { af: string; en: string };
  loadPostIndex: () => Promise<PostSummary[]>;
  offeredCategories: CategoryOption[];
  // The "featured" bookkeeping term's id, resolved by slug from the injected
  // taxonomy (never a hardcoded number — the term's id is data). Undefined when
  // the taxonomy carries no such term; publish then leaves categories untouched.
  featuredTermId?: number;
  now: () => Date;
  createDraftId: () => string;
  waitUntil: (promise: Promise<unknown>) => void;
  buildUploadLink?: (draftId: string) => string | Promise<string>;
  translation?: TranslationConfig;
  content?: ContentSource;
  publishing?: PublishConfig;
}

// The spec's internal terms (spec §198-209): never offered as recipe categories.
const FEATURED_TERM_SLUG = "featured";
const INTERNAL_TERM_SLUGS = new Set([FEATURED_TERM_SLUG, "uncategorised", "uncategorized", "eenhede"]);

function isInternalTerm(category: CategoryOption): boolean {
  return (
    INTERNAL_TERM_SLUGS.has(category.slug.toLowerCase()) ||
    INTERNAL_TERM_SLUGS.has(category.name.toLowerCase())
  );
}

function resolveFeaturedTermId(categories: CategoryOption[]): number | undefined {
  return categories.find((category) => category.slug.toLowerCase() === FEATURED_TERM_SLUG)?.id;
}

function normalizePostIndex(
  postIndex: PostSummary[] | (() => PostSummary[] | Promise<PostSummary[]>),
): () => Promise<PostSummary[]> {
  if (typeof postIndex === "function") {
    return async () => postIndex();
  }
  return async () => postIndex;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: "marindakook-cms", version: "0.1.0" });

  const context: ToolContext = {
    store: deps.store,
    interviewProtocol: deps.interviewProtocol,
    styleGuides: deps.styleGuides,
    loadPostIndex: normalizePostIndex(deps.postIndex),
    offeredCategories: (deps.categories ?? []).filter((category) => !isInternalTerm(category)),
    featuredTermId: resolveFeaturedTermId(deps.categories ?? []),
    now: deps.now ?? (() => new Date()),
    createDraftId: deps.createDraftId ?? (() => crypto.randomUUID()),
    waitUntil: deps.waitUntil ?? ((promise) => void promise.catch(() => undefined)),
    buildUploadLink: deps.buildUploadLink,
    translation: deps.translation,
    content: deps.content,
    publishing: deps.publishing,
  };

  registerDraftTools(server, context);
  registerVoiceTools(server, context);
  registerPhotoTools(server, context);
  registerTranslationTools(server, context);
  registerEditTools(server, context);
  registerChromeTools(server, context);
  registerPublishTools(server, context);

  return server;
}
