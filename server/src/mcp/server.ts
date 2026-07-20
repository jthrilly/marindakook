import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostSummary } from "@site/lib/content-derive";
import type { DraftStore } from "../core/store";
import { registerDraftTools } from "./tools/drafts";
import { registerVoiceTools } from "./tools/voice";

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
}

export interface ToolContext {
  store: DraftStore;
  interviewProtocol: string;
  styleGuides: { af: string; en: string };
  loadPostIndex: () => Promise<PostSummary[]>;
  offeredCategories: CategoryOption[];
  now: () => Date;
  createDraftId: () => string;
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
  };

  registerDraftTools(server, context);
  registerVoiceTools(server, context);

  return server;
}
