/// <reference types="vite/client" />
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { PostSummary } from "@site/lib/content-derive";
import { pageSchema, postSchema, siteSchema, type Page, type Site } from "@site/lib/content-schema";
import { GitHubApp, type GitHubClient } from "./core/github";
import { signLink, verifyLink, type LinkKind } from "./core/links";
import { KvR2Store } from "./core/store";
import {
  createMcpServer,
  type CategoryOption,
  type ContentSource,
  type McpServerDeps,
  type PublishConfig,
} from "./mcp/server";
import { handleAuthorize } from "./pages/auth";
import { handleApprove, renderExpiredLinkPage, renderPreviewPage } from "./pages/preview";
import { handleUploadDelete, handleUploadPost, renderUploadPage } from "./pages/upload";

// The Worker entry point: the OAuthProvider wraps everything, gating `/mcp`
// behind an access token and passing every other request to `defaultHandler`
// (the signed-link pages + the Afrikaans login). All the authoritative text and
// taxonomy the MCP tools need is bundled here — the interview protocol, both
// style guides, the translate prompt, the term list, the site chrome + pages,
// and a build-time snapshot of the post index — because the Worker runtime
// cannot read the repo's files from disk.
//
// Bundled with Vite's `?raw` (text) and validated through the shared schemas so
// there is no cast and a corrupt bundle fails loudly at startup. `?raw` is a Vite
// feature, so BOTH the tests (`@cloudflare/vitest-pool-workers`) and the deploy
// build (`@cloudflare/vite-plugin`, `server/vite.config.ts` — run via
// `npm run build`/`npm run deploy`) resolve and inline these files identically. A
// bare esbuild `wrangler deploy` cannot resolve the `?raw` suffix; see README step 3.
import interviewProtocolText from "../prompts/interview-af.md?raw";
import translatePromptText from "../prompts/translate-en.md?raw";
import styleGuideAfText from "../../content/style-guide.af.md?raw";
import styleGuideEnText from "../../content/style-guide.en.md?raw";
import termsRaw from "../../content/terms.json?raw";
import siteRaw from "../../content/site.json?raw";
import oorMyPageRaw from "../../content/pages/oor-my.json?raw";
import optredesPageRaw from "../../content/pages/optredes.json?raw";
import postIndexRaw from "./generated/posts-index.json?raw";

const termsSchema = z.object({
  categories: z.array(
    z.object({ id: z.number(), name: z.string(), slug: z.string(), parent: z.number().optional() }),
  ),
});

// PostSummary is an interface, not a zod schema; this mirrors it exactly and
// reuses the shared featured-image shape so the snapshot is validated, not cast.
const postSummarySchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  excerpt: z.string(),
  categories: z.array(z.number()),
  tags: z.array(z.number()),
  featured: postSchema.shape.featured,
  hasRecipe: z.boolean(),
  commentCount: z.number(),
});

const bundledCategories: CategoryOption[] = termsSchema.parse(JSON.parse(termsRaw)).categories.map(
  (category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    parent: category.parent === undefined || category.parent === 0 ? undefined : category.parent,
  }),
);

const bundledSite: Site = siteSchema.parse(JSON.parse(siteRaw));
const bundledPages: Page[] = [
  pageSchema.parse(JSON.parse(oorMyPageRaw)),
  pageSchema.parse(JSON.parse(optredesPageRaw)),
];
const bundledPostIndex: PostSummary[] = z.array(postSummarySchema).parse(JSON.parse(postIndexRaw));

const BASE_BRANCH = "main";

function buildGitHub(env: Env): GitHubClient | null {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_INSTALLATION_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_OWNER ||
    !env.GITHUB_REPO
  ) {
    return null;
  }
  return new GitHubApp({
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_INSTALLATION_ID,
    privateKeyPkcs8Pem: env.GITHUB_APP_PRIVATE_KEY,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    fetch,
  });
}

function siteBaseUrlOf(env: Env): string {
  if (env.SITE_BASE_URL) {
    return env.SITE_BASE_URL.replace(/\/$/, "");
  }
  return `https://${env.GITHUB_OWNER ?? "marinda"}.github.io/${env.GITHUB_REPO ?? "marindakook"}`;
}

function buildPublishConfig(env: Env, github: GitHubClient | null): PublishConfig | undefined {
  if (github === null) {
    return undefined;
  }
  return {
    github,
    // Pilot mode (publish-as-PR) is the safe default; it is only left once
    // PILOT_MODE is explicitly set to "false" (spec go-live checklist).
    pilotMode: env.PILOT_MODE !== "false",
    baseBranch: BASE_BRANCH,
    siteBaseUrl: siteBaseUrlOf(env),
    reviewer: env.REVIEWER ?? "Joshua",
  };
}

async function fetchCommittedJson<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return null;
    }
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // Network rejection (DNS/TLS/connection) or a 200 with a non-JSON body
    // (`response.json()` throwing) — either way, degrade to the bundle below
    // rather than letting the exception propagate to `guardToolThrows`.
    return null;
  }
}

// Reads committed content the edit/chrome/publish tools need. Every read fetches
// LIVE committed state from the public repo's raw content, so chrome/page edits
// merge onto the current on-main state rather than a frozen build-time bundle
// (which would silently revert a prior edit). The bundled snapshot is the
// fallback for ANY fetch/parse failure — network error, non-200, or a bad body
// (invalid JSON or schema mismatch) — so a transient hiccup degrades instead of
// throwing. `fetchImpl` is injected so tests drive the live-vs-fallback paths
// without the network.
export function buildContentSource(
  env: Pick<Env, "GITHUB_OWNER" | "GITHUB_REPO">,
  fetchImpl: typeof fetch = fetch,
): ContentSource | undefined {
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return undefined;
  }
  const rawBase = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${BASE_BRANCH}/content`;
  return {
    loadPost: (slug) => fetchCommittedJson(`${rawBase}/posts/${slug}.json`, postSchema, fetchImpl),
    loadPage: async (slug) =>
      (await fetchCommittedJson(`${rawBase}/pages/${slug}.json`, pageSchema, fetchImpl)) ??
      (bundledPages.find((page) => page.slug === slug) ?? null),
    loadSite: async () =>
      (await fetchCommittedJson(`${rawBase}/site.json`, siteSchema, fetchImpl)) ?? bundledSite,
    pageSlugs: bundledPages.map((page) => page.slug),
  };
}

function buildLinkBuilder(env: Env, origin: string, kind: LinkKind): (draftId: string) => Promise<string> {
  const page = kind === "upload" ? "upload" : "preview";
  return async (draftId) => `${origin}/${page}?sig=${await signLink({ draftId, kind }, env.LINK_SECRET)}`;
}

function buildMcpDeps(env: Env, ctx: ExecutionContext, origin: string): McpServerDeps {
  const github = buildGitHub(env);
  return {
    store: new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS }),
    interviewProtocol: interviewProtocolText,
    styleGuides: { af: styleGuideAfText, en: styleGuideEnText },
    translatePrompt: translatePromptText,
    postIndex: bundledPostIndex,
    categories: bundledCategories,
    waitUntil: (promise) => ctx.waitUntil(promise),
    buildUploadLink: buildLinkBuilder(env, origin, "upload"),
    buildPreviewLink: buildLinkBuilder(env, origin, "preview"),
    content: buildContentSource(env),
    publishing: buildPublishConfig(env, github),
    alert: { webhookUrl: env.ALERT_WEBHOOK, fetch },
  };
}

// Each MCP request builds a fresh server + stateless transport: the Worker keeps
// no in-memory session state (every isolate may be different), so all state
// lives in KV/R2 and each JSON-RPC request is self-contained.
async function serveMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = new URL(request.url).origin;
  const server = createMcpServer(buildMcpDeps(env, ctx, origin));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return serveMcp(request, env, ctx);
  },
};

function tokenOf(request: Request): string {
  return new URL(request.url).searchParams.get("sig") ?? "";
}

function linkVerifier(env: Env, kind: LinkKind): (token: string) => Promise<{ draftId: string } | null> {
  return async (token) => {
    const payload = await verifyLink(token, env.LINK_SECRET);
    return payload !== null && payload.kind === kind ? { draftId: payload.draftId } : null;
  };
}

function methodNotAllowed(): Response {
  return new Response("Metode nie toegelaat nie.", {
    status: 405,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function routeUpload(request: Request, env: Env): Promise<Response> {
  const verify = linkVerifier(env, "upload");
  const deps = { store: new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS }), verifyLink: verify };
  if (request.method === "GET") {
    const claims = await verify(tokenOf(request));
    return claims === null ? renderExpiredLinkPage() : renderUploadPage(claims.draftId);
  }
  if (request.method === "POST") {
    return handleUploadPost(request, deps);
  }
  if (request.method === "DELETE") {
    return handleUploadDelete(request, deps);
  }
  return methodNotAllowed();
}

async function routePreview(request: Request, env: Env): Promise<Response> {
  const verify = linkVerifier(env, "preview");
  const deps = { store: new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS }), verifyLink: verify };
  if (request.method === "GET") {
    const claims = await verify(tokenOf(request));
    return claims === null ? renderExpiredLinkPage() : renderPreviewPage(claims.draftId, deps);
  }
  if (request.method === "POST") {
    return handleApprove(request, deps);
  }
  return methodNotAllowed();
}

async function routeApprove(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }
  const verify = linkVerifier(env, "preview");
  return handleApprove(request, { store: new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS }), verifyLink: verify });
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/oauth/authorize" || path === "/login") {
      return handleAuthorize(request, env);
    }
    if (path === "/upload") {
      return routeUpload(request, env);
    }
    if (path === "/preview") {
      return routePreview(request, env);
    }
    if (path === "/approve") {
      return routeApprove(request, env);
    }
    return new Response("Nie gevind nie.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

// 30-day access tokens with never-expiring refresh tokens: the spec asks for
// maximum session life so Marinda is never surprised by a re-login mid-authoring
// (the client's own English "reconnect" prompt is rehearsed during onboarding).
const worker = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["cms"],
  accessTokenTTL: 60 * 60 * 24 * 30,
  refreshTokenTTL: undefined,
});

export default worker;
