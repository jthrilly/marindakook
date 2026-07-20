import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostSummary } from "@site/lib/content-derive";
import type { DraftStore } from "../core/store";
import { registerDraftTools } from "./tools/drafts";
import { registerPhotoTools } from "./tools/photos";
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
}

export interface ToolContext {
  store: DraftStore;
  interviewProtocol: string;
  styleGuides: { af: string; en: string };
  loadPostIndex: () => Promise<PostSummary[]>;
  offeredCategories: CategoryOption[];
  now: () => Date;
  createDraftId: () => string;
  waitUntil: (promise: Promise<unknown>) => void;
  buildUploadLink?: (draftId: string) => string | Promise<string>;
  translation?: TranslationConfig;
}

// The spec's internal terms (spec §198-209): never offered as recipe categories.
const INTERNAL_TERM_SLUGS = new Set(["featured", "uncategorised", "uncategorized", "eenhede"]);

function isInternalTerm(category: CategoryOption): boolean {
  return (
    INTERNAL_TERM_SLUGS.has(category.slug.toLowerCase()) ||
    INTERNAL_TERM_SLUGS.has(category.name.toLowerCase())
  );
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
    now: deps.now ?? (() => new Date()),
    createDraftId: deps.createDraftId ?? (() => crypto.randomUUID()),
    waitUntil: deps.waitUntil ?? ((promise) => void promise.catch(() => undefined)),
    buildUploadLink: deps.buildUploadLink,
    translation: deps.translation,
  };

  registerDraftTools(server, context);
  registerVoiceTools(server, context);
  registerPhotoTools(server, context);
  registerTranslationTools(server, context);

  return server;
}
