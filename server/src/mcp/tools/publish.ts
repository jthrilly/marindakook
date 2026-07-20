import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageSchema, postSchema, siteSchema, translationSchema, type Translation } from "@site/lib/content-schema";
import { sourceHashOf } from "@site/lib/source-hash";
import type { CommitFile, PullRequestInput, PullRequestResult } from "../../core/github";
import { GitHubError } from "../../core/github";
import { resolveSlug, slugify } from "../../core/slug";
import { nextPostId } from "../../core/ids";
import type { ChromeDraft, DraftPost } from "../../core/draft-schema";
import type { JsonValue } from "../../core/store";
import { buildTranslationSource, parseJobRecord } from "../../core/translation-job";
import {
  RESERVED_SLUGS,
  applyFeaturedTerm,
  applySiteChrome,
  buildFeatured,
  buildPageCandidate,
  buildPostCandidate,
  buildRecipeImage,
  mediaCommitPath,
  mediaSubfolder,
  mediaUrl,
  reconcileTranslation,
  serializeContent,
} from "../../core/publish-build";
import type { ContentSource, PublishConfig, ToolContext } from "../server";
import { describeZodIssue } from "../issues";
import { ok, fail } from "../result";

const APPROVAL_REFUSAL = "Ek kan nog nie publiseer nie — die voorskou is nog nie goedgekeur nie. Maak 'n voorskou, keur dit goed, en probeer weer.";

const POSTS_DIR = "content/posts";
const PAGES_DIR = "content/pages";
const POST_TRANSLATIONS_DIR = "content/translations/en/posts";
const PAGE_TRANSLATIONS_DIR = "content/translations/en/pages";
const SITE_PATH = "content/site.json";

function baseBranchOf(cfg: PublishConfig): string {
  return cfg.baseBranch ?? "main";
}

function reviewerOf(cfg: PublishConfig): string {
  return cfg.reviewer ?? "Joshua";
}

// WordPress-style timestamp (no milliseconds, no trailing Z) to match every
// existing post's `date`/`modified`.
function wpDate(now: Date): string {
  return now.toISOString().slice(0, 19);
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Build the committed translation file from the model's candidate, picking ONLY
// the fields translationSchema covers (dropping any extra keys) and stamping the
// real id/slug + the source hash. Returns null if the candidate is not an object.
function translationFileFrom(
  candidate: JsonValue,
  id: number,
  slug: string,
  sourceHash: string,
): { [key: string]: JsonValue } | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const file: { [key: string]: JsonValue } = {
    id,
    slug,
    sourceHash,
    title: candidate.title ?? "",
    seo: candidate.seo ?? null,
    html: candidate.html ?? "",
  };
  if (candidate.excerpt !== undefined) {
    file.excerpt = candidate.excerpt;
  }
  if (candidate.recipe !== undefined) {
    file.recipe = candidate.recipe;
  }
  return file;
}

// Open a PR, tolerating the "a pull request already exists for this head" 422 a
// retry hits after a dropped `openPullRequest` response: resolve and return the
// existing open PR instead of surfacing a false failure. Every PR-open path
// (pilot publish, delete_post, failing-translation PR) goes through this.
async function openOrFindPr(cfg: PublishConfig, input: PullRequestInput): Promise<PullRequestResult> {
  try {
    return await cfg.github.openPullRequest(input);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) {
      const existing = await cfg.github.findOpenPullRequest(input.head);
      if (existing !== null) {
        return existing;
      }
    }
    throw err;
  }
}

interface LandResult {
  kind: "direct" | "pilot";
  commitSha?: string;
  pr?: number;
  url?: string;
}

// Commit directly to the base branch, or (pilot mode) branch → commit → PR so
// Joshua reviews. `createBranch` runs first because `commitFiles` only updates
// an existing ref.
async function land(
  cfg: PublishConfig,
  input: {
    draftId: string;
    files: CommitFile[];
    deletions?: string[];
    message: string;
    requireAbsent?: string[];
    expectShas?: Record<string, string>;
    prTitle: string;
    prBody: string;
    branchName: string;
  },
): Promise<LandResult> {
  const branch = baseBranchOf(cfg);
  if (!cfg.pilotMode) {
    const res = await cfg.github.commitFiles({
      files: input.files,
      deletions: input.deletions,
      message: input.message,
      draftId: input.draftId,
      branch,
      requireAbsent: input.requireAbsent,
      expectShas: input.expectShas,
    });
    return { kind: "direct", commitSha: res.commitSha };
  }
  const base = await cfg.github.getBaseTree(branch);
  await cfg.github.createBranch(input.branchName, base.commitSha);
  await cfg.github.commitFiles({
    files: input.files,
    deletions: input.deletions,
    message: input.message,
    draftId: input.draftId,
    branch: input.branchName,
    requireAbsent: input.requireAbsent,
    expectShas: input.expectShas,
  });
  const pr = await openOrFindPr(cfg, {
    title: input.prTitle,
    head: input.branchName,
    base: branch,
    body: input.prBody,
  });
  return { kind: "pilot", pr: pr.number, url: pr.url };
}

async function deleteStagedPhotos(ctx: ToolContext, draftId: string): Promise<void> {
  const photos = await ctx.store.listPhotos(draftId);
  for (const photo of photos) {
    await ctx.store.deletePhoto(draftId, photo.filename);
  }
}

async function photoCommitFiles(
  ctx: ToolContext,
  draftId: string,
  subfolder: string,
): Promise<CommitFile[]> {
  const photos = await ctx.store.listPhotos(draftId);
  const files: CommitFile[] = [];
  for (const photo of photos) {
    const stored = await ctx.store.getPhoto(draftId, photo.filename);
    if (stored === null) {
      continue;
    }
    files.push({
      path: mediaCommitPath(subfolder, photo.filename),
      content: bytesToBase64(stored.bytes),
      encoding: "base64",
    });
  }
  return files;
}

function directSuccessMessage(cfg: PublishConfig, slug: string, engelsLater: boolean): string {
  const url = `${cfg.siteBaseUrl}/${slug}/`;
  const base = `Klaar! Jou pos is gepubliseer en verskyn oor omtrent drie minute hier: ${url}`;
  return engelsLater
    ? `${base}\n\nDie Engelse vertaling het nog nie die keuring geslaag nie, so die pos wys eers net in Afrikaans — ${reviewerOf(cfg)} kyk na die Engels en dit volg later.`
    : base;
}

function pilotSuccessMessage(cfg: PublishConfig, url: string): string {
  return `Ek het jou pos gestuur vir ${reviewerOf(cfg)} se goedkeuring — jy hoef niks verder te doen nie. Sodra hy dit goedkeur, gaan dit vanself regstreeks.\n\n${url}`;
}

async function publishChrome(
  ctx: ToolContext,
  cfg: PublishConfig,
  content: ContentSource,
  draft: ChromeDraft,
): Promise<ReturnType<typeof ok>> {
  const branch = baseBranchOf(cfg);

  // Idempotency: git is the authority. If the draft's commit is already on the
  // base branch — a merged pilot PR or a direct-landed commit — report the live
  // success, NOT the pilot "awaiting approval" message (a merged PR is live on
  // main). Mirrors the order check_publish_status uses.
  const landed = await cfg.github.findDraftCommit(draft.draftId, branch);
  if (landed !== null) {
    await ctx.store.setPublish(draft.draftId, { mode: "direct", commitSha: landed, kind: "chrome" });
    return ok("Die webwerf-teks is reeds gepubliseer — niks verder om te doen nie.", {
      draftId: draft.draftId,
      alreadyPublished: true,
    });
  }

  // Idempotency (pilot): nothing landed on main yet, but a prior attempt already
  // opened the PR (its commit lands on the PR branch, not main). Replay the same
  // honest "gestuur vir Joshua" success without re-hitting GitHub.
  if (cfg.pilotMode) {
    const recorded = await recordedPilotPr(ctx, draft.draftId);
    if (recorded !== null) {
      return ok(pilotSuccessMessage(cfg, recorded.url), {
        draftId: draft.draftId,
        mode: "pilot",
        url: recorded.url,
      });
    }
  }

  const site = await content.loadSite();
  const merged = applySiteChrome(site, draft.site);
  const parsed = siteSchema.safeParse(merged);
  if (!parsed.success) {
    return fail(`Ek kan die webwerf-teks nog nie publiseer nie — ${describeZodIssue(parsed.error.issues[0])}`);
  }

  const existing = await cfg.github.pathExists(SITE_PATH, branch);
  const files: CommitFile[] = [{ path: SITE_PATH, content: serializeContent(parsed.data) }];
  const result = await land(cfg, {
    draftId: draft.draftId,
    files,
    message: "Werk webwerf-teks by",
    expectShas: existing.exists && existing.sha !== undefined ? { [SITE_PATH]: existing.sha } : undefined,
    prTitle: "Werk webwerf-teks by",
    prBody: `${reviewerOf(cfg)}, hierdie PR werk die webwerf-teks by.`,
    branchName: `cms/webwerf-teks-${draft.draftId}`,
  });

  if (result.kind === "pilot" && result.url !== undefined) {
    await ctx.store.setPublish(draft.draftId, { mode: "pilot", pr: result.pr ?? 0, url: result.url, kind: "chrome" });
    return ok(pilotSuccessMessage(cfg, result.url), { draftId: draft.draftId, mode: "pilot", url: result.url });
  }
  await ctx.store.setPublish(draft.draftId, { mode: "direct", commitSha: result.commitSha ?? "", kind: "chrome" });
  return ok(
    "Klaar! Die webwerf-teks is bygewerk en verskyn oor omtrent drie minute. Onthou die Engelse weergawe word deur die stelsel se vertaal-net nagegaan.",
    { draftId: draft.draftId, mode: "direct" },
  );
}

async function publishPostOrPage(
  ctx: ToolContext,
  cfg: PublishConfig,
  content: ContentSource,
  draft: DraftPost,
): Promise<ReturnType<typeof ok>> {
  const now = ctx.now();
  const nowIso = wpDate(now);
  const rawSlug = draft.slug ?? slugify(draft.title ?? "");

  const existingPost = await content.loadPost(rawSlug);
  const existingPage = existingPost === null ? await content.loadPage(rawSlug) : null;

  // Pages: edit-only, simpler shape, no recipe/photos/featured.
  if (existingPage !== null) {
    const candidate = buildPageCandidate(draft, existingPage.slug, {
      id: existingPage.id,
      date: existingPage.date,
      modified: nowIso,
    });
    const parsed = pageSchema.safeParse(candidate);
    if (!parsed.success) {
      return fail(`Ek kan nog nie publiseer nie — ${describeZodIssue(parsed.error.issues[0])}`);
    }
    return commitPage(ctx, cfg, {
      draft,
      slug: existingPage.slug,
      title: parsed.data.title,
      docPath: `${PAGES_DIR}/${existingPage.slug}.json`,
      docContent: serializeContent(parsed.data),
    });
  }

  // Posts: build the complete Post, preserving an existing post's imagery when
  // an edit adds no new hero. Media paths derive from the draft's createdAt (a
  // stable draft field), NOT publish-time `now`, so a retried commit reproduces
  // byte-identical paths (spec §340).
  const subfolder = mediaSubfolder(new Date(draft.createdAt));
  const photos = await ctx.store.listPhotos(draft.draftId);
  const heroFilename = draft.interview?.heroPhoto;
  const heroUrl =
    heroFilename !== undefined && photos.some((p) => p.filename === heroFilename)
      ? mediaUrl(subfolder, heroFilename)
      : null;
  const alt = draft.title ?? existingPost?.title ?? "";

  const isCreate = existingPost === null;
  const id = existingPost?.id ?? nextPostId((await ctx.loadPostIndex()).map((p) => p.id));
  const slug = existingPost?.slug ?? (await resolveNewSlug(ctx, content, rawSlug, draft.draftId));

  const featured = heroUrl !== null ? buildFeatured(heroUrl, alt) : (existingPost?.featured ?? null);
  const recipeImage =
    heroUrl !== null ? buildRecipeImage(heroUrl, alt) : (existingPost?.recipe?.image ?? null);

  // Reconcile the "featured" term against the interview's voorblad answer so a
  // chat-published featured post lands in the homepage featured grid (and an
  // un-featuring edit drops it). The term id is resolved by slug from the
  // injected taxonomy; when absent the categories are left untouched.
  const categories = applyFeaturedTerm(
    draft.categories ?? [],
    draft.interview?.featured === true,
    ctx.featuredTermId ?? null,
  );

  const candidate = buildPostCandidate(draft, slug, {
    id,
    date: existingPost?.date ?? nowIso,
    modified: nowIso,
    commentStatus: existingPost?.commentStatus ?? "closed",
    comments: existingPost?.comments ?? [],
    categories,
    featured,
    recipeImage,
  });
  const parsed = postSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail(`Ek kan nog nie publiseer nie — ${describeZodIssue(parsed.error.issues[0])}`);
  }
  const post = parsed.data;

  // Translation gate: a current passing translation is required, unless the
  // validator was exhausted (a "failing" result for the current source), in
  // which case publish proceeds Afrikaans-only and PRs the failing translation.
  const currentHash = sourceHashOf(buildTranslationSource(draft));
  const job = parseJobRecord(await ctx.store.getJob(draft.draftId));
  let translationFile: Translation | null = null;
  let failingTranslation: { [key: string]: JsonValue } | null = null;
  // Exhaustion (validator gave up for the current source) means publish proceeds
  // Afrikaans-only with "Engels volg later" — true even when no candidate exists.
  let translationExhausted = false;

  if (job !== null && job.sourceHash === currentHash && job.status === "passing") {
    // Reconcile the model's loose passing candidate against the built POST: the
    // committed file carries the candidate's translated text over the post's strict
    // recipe/image/details and is stamped sourceHashOf(post) — the basis CI checks.
    const built = reconcileTranslation(job.translation, post);
    if (built === null) {
      return fail("Die gestoorde Engelse vertaling is stukkend. Vra 'n nuwe een aan met generate_translation.");
    }
    const check = translationSchema.safeParse(built);
    if (!check.success) {
      return fail(`Die Engelse vertaling is nie geldig nie — ${describeZodIssue(check.error.issues[0])}`);
    }
    translationFile = check.data;
  } else if (job !== null && job.sourceHash === currentHash && job.status === "failing") {
    translationExhausted = true;
    failingTranslation =
      job.translation === null ? null : translationFileFrom(job.translation, id, slug, currentHash);
  } else {
    return fail(
      "Die Engelse vertaling is nog nie gereed nie. Vra dit aan met generate_translation en kyk met check_translation_status voor jy publiseer.",
    );
  }

  return commitPost(ctx, cfg, {
    draft,
    post,
    isCreate,
    subfolder,
    translationFile,
    failingTranslation,
    translationExhausted,
  });
}

async function resolveNewSlug(
  ctx: ToolContext,
  content: ContentSource,
  rawSlug: string,
  selfDraftId: string,
): Promise<string> {
  const index = await ctx.loadPostIndex();
  const openDrafts = await ctx.store.list();
  const draftSlugs = openDrafts
    .filter((entry) => entry.draft.draftId !== selfDraftId)
    .map((entry) => (entry.draft.kind === "post" ? entry.draft.slug : undefined))
    .filter((value): value is string => typeof value === "string");
  const taken = new Set<string>([
    ...RESERVED_SLUGS,
    ...index.map((p) => p.slug),
    ...content.pageSlugs,
    ...draftSlugs,
  ]);
  return resolveSlug(rawSlug, taken);
}

// Shared post-commit path: assemble the files, run the git-state idempotency
// guard, land (direct or PR), and only then delete the staged photos.
async function commitPost(
  ctx: ToolContext,
  cfg: PublishConfig,
  input: {
    draft: DraftPost;
    post: { slug: string; title: string; id: number };
    isCreate: boolean;
    subfolder: string;
    translationFile: Translation | null;
    failingTranslation: { [key: string]: JsonValue } | null;
    translationExhausted: boolean;
  },
): Promise<ReturnType<typeof ok>> {
  const branch = baseBranchOf(cfg);
  const { draft, post } = input;
  const docPath = `${POSTS_DIR}/${post.slug}.json`;
  const translationPath = `${POST_TRANSLATIONS_DIR}/${post.slug}.json`;
  // Direct publish with a failing (exhausted) translation candidate: the English
  // is PR'd for Joshua while Afrikaans goes live. Non-null exactly when such a
  // best-effort PR is due (narrows the candidate for the PR calls below).
  const failingTranslationForPr =
    !cfg.pilotMode && input.translationFile === null ? input.failingTranslation : null;

  // Idempotency: git is the authority. If the draft's commit is already on the
  // base branch — a merged pilot PR or a direct-landed commit — report the live
  // success (NOT the pilot "awaiting approval" message: a merged PR is live on
  // main). Re-attempt the failing-translation PR (idempotent) so a retry after
  // the main commit landed but before the English PR opened does not skip it.
  const landed = await cfg.github.findDraftCommit(draft.draftId, branch);
  if (landed !== null) {
    await deleteStagedPhotos(ctx, draft.draftId);
    await ctx.store.setPublish(draft.draftId, { mode: "direct", commitSha: landed, slug: post.slug });
    const translationPrError =
      failingTranslationForPr !== null
        ? await ensureFailingTranslationPr(cfg, {
            slug: post.slug,
            title: post.title,
            translationPath,
            translation: failingTranslationForPr,
          })
        : undefined;
    return ok(directSuccessMessage(cfg, post.slug, input.translationExhausted), {
      draftId: draft.draftId,
      slug: post.slug,
      alreadyPublished: true,
      ...(translationPrError !== undefined ? { translationPrError } : {}),
    });
  }

  // Idempotency (pilot): nothing landed on main yet, but a prior attempt already
  // opened the PR (its commit lands on the PR branch, not main, so findDraftCommit
  // above can't see it). Replay the same honest "gestuur vir Joshua" success from
  // the recorded PR without re-hitting GitHub.
  if (cfg.pilotMode) {
    const recorded = await recordedPilotPr(ctx, draft.draftId);
    if (recorded !== null) {
      await deleteStagedPhotos(ctx, draft.draftId);
      return ok(pilotSuccessMessage(cfg, recorded.url), {
        draftId: draft.draftId,
        mode: "pilot",
        slug: post.slug,
        url: recorded.url,
      });
    }
  }

  const files = await photoCommitFiles(ctx, draft.draftId, input.subfolder);
  // Post JSON first; it must reproduce byte-for-byte under the CI sourceHash net.
  files.unshift({ path: docPath, content: serializeContent(post) });

  const inPilotTranslation = cfg.pilotMode && input.failingTranslation !== null;
  if (input.translationFile !== null) {
    files.push({ path: translationPath, content: serializeContent(input.translationFile) });
  } else if (inPilotTranslation && input.failingTranslation !== null) {
    files.push({ path: translationPath, content: serializeContent(input.failingTranslation) });
  }

  const requireAbsent = input.isCreate ? [docPath] : undefined;
  let expectShas: Record<string, string> | undefined;
  if (!input.isCreate) {
    const state = await cfg.github.pathExists(docPath, branch);
    if (state.exists && state.sha !== undefined) {
      expectShas = { [docPath]: state.sha };
    }
  }

  const verb = input.isCreate ? "Publiseer" : "Werk";
  const result = await land(cfg, {
    draftId: draft.draftId,
    files,
    message: `${verb} resep: ${post.title}`,
    requireAbsent,
    expectShas,
    prTitle: `${verb} resep: ${post.title}`,
    prBody: `${reviewerOf(cfg)}, hierdie PR ${input.isCreate ? "publiseer" : "werk"} «${post.title}».`,
    branchName: `cms/publiseer-${draft.draftId}`,
  });

  // Git confirms success → the staged photos are safe to remove.
  await deleteStagedPhotos(ctx, draft.draftId);

  if (result.kind === "pilot" && result.url !== undefined) {
    await ctx.store.setPublish(draft.draftId, {
      mode: "pilot",
      pr: result.pr ?? 0,
      url: result.url,
      slug: post.slug,
    });
    return ok(pilotSuccessMessage(cfg, result.url), {
      draftId: draft.draftId,
      mode: "pilot",
      slug: post.slug,
      url: result.url,
    });
  }

  await ctx.store.setPublish(draft.draftId, {
    mode: "direct",
    commitSha: result.commitSha ?? "",
    slug: post.slug,
  });

  // Direct publish with a failing translation: PR the failing English for Joshua
  // (Afrikaans is already live). Best-effort — a PR failure must not mask the
  // successful post publish, so surface it rather than throw.
  const translationPrError =
    failingTranslationForPr !== null
      ? await ensureFailingTranslationPr(cfg, {
          slug: post.slug,
          title: post.title,
          translationPath,
          translation: failingTranslationForPr,
        })
      : undefined;

  return ok(directSuccessMessage(cfg, post.slug, input.translationExhausted), {
    draftId: draft.draftId,
    mode: "direct",
    slug: post.slug,
    commitSha: result.commitSha,
    ...(translationPrError !== undefined ? { translationPrError } : {}),
  });
}

// Page commit (no photos, no translation gate): pages are edit-only.
async function commitPage(
  ctx: ToolContext,
  cfg: PublishConfig,
  input: {
    draft: DraftPost;
    slug: string;
    title: string;
    docPath: string;
    docContent: string;
  },
): Promise<ReturnType<typeof ok>> {
  const branch = baseBranchOf(cfg);

  // Idempotency: git is the authority. If the draft's commit is already on the
  // base branch — a merged pilot PR or a direct-landed commit — report the live
  // success, NOT the pilot "awaiting approval" message (a merged PR is live on
  // main). Mirrors the order check_publish_status uses.
  const landed = await cfg.github.findDraftCommit(input.draft.draftId, branch);
  if (landed !== null) {
    await ctx.store.setPublish(input.draft.draftId, { mode: "direct", commitSha: landed, slug: input.slug });
    return ok(`Klaar! Die bladsy «${input.title}» is bygewerk.`, {
      draftId: input.draft.draftId,
      slug: input.slug,
      alreadyPublished: true,
    });
  }

  // Idempotency (pilot): nothing landed on main yet, but a prior attempt already
  // opened the PR (its commit lands on the PR branch, not main). Replay the same
  // honest "gestuur vir Joshua" success without re-hitting GitHub.
  if (cfg.pilotMode) {
    const recorded = await recordedPilotPr(ctx, input.draft.draftId);
    if (recorded !== null) {
      return ok(pilotSuccessMessage(cfg, recorded.url), {
        draftId: input.draft.draftId,
        mode: "pilot",
        slug: input.slug,
        url: recorded.url,
      });
    }
  }

  const state = await cfg.github.pathExists(input.docPath, branch);
  const expectShas =
    state.exists && state.sha !== undefined ? { [input.docPath]: state.sha } : undefined;

  const result = await land(cfg, {
    draftId: input.draft.draftId,
    files: [{ path: input.docPath, content: input.docContent }],
    message: `Werk bladsy by: ${input.title}`,
    expectShas,
    prTitle: `Werk bladsy by: ${input.title}`,
    prBody: `${reviewerOf(cfg)}, hierdie PR werk die bladsy «${input.title}» by.`,
    branchName: `cms/bladsy-${input.draft.draftId}`,
  });

  if (result.kind === "pilot" && result.url !== undefined) {
    await ctx.store.setPublish(input.draft.draftId, {
      mode: "pilot",
      pr: result.pr ?? 0,
      url: result.url,
      slug: input.slug,
    });
    return ok(pilotSuccessMessage(cfg, result.url), {
      draftId: input.draft.draftId,
      mode: "pilot",
      slug: input.slug,
      url: result.url,
    });
  }
  await ctx.store.setPublish(input.draft.draftId, {
    mode: "direct",
    commitSha: result.commitSha ?? "",
    slug: input.slug,
  });
  return ok(`Klaar! Die bladsy «${input.title}» is bygewerk en verskyn oor omtrent drie minute.`, {
    draftId: input.draft.draftId,
    mode: "direct",
    slug: input.slug,
  });
}

// Branch → commit → PR the failing English translation. Idempotent end-to-end:
// createBranch tolerates a 422, commitFiles is branch-idempotent via the
// Draft-Id trailer, and openOrFindPr resolves the existing PR on a retry.
async function openFailingTranslationPr(
  cfg: PublishConfig,
  input: { slug: string; title: string; translationPath: string; translation: { [key: string]: JsonValue } },
): Promise<void> {
  const branch = baseBranchOf(cfg);
  const base = await cfg.github.getBaseTree(branch);
  const branchName = `cms/vertaling-${input.slug}`;
  await cfg.github.createBranch(branchName, base.commitSha);
  await cfg.github.commitFiles({
    files: [{ path: input.translationPath, content: serializeContent(input.translation) }],
    message: `Engelse vertaling vir ${input.title} (hersiening benodig)`,
    draftId: `vertaling-${input.slug}`,
    branch: branchName,
  });
  await openOrFindPr(cfg, {
    title: `Engelse vertaling: ${input.title} (vir ${reviewerOf(cfg)})`,
    head: branchName,
    base: branch,
    body: `Die outomatiese Engelse vertaling het die keuring nie geslaag nie. ${reviewerOf(cfg)}, kyk asseblief hierna en werk dit reg.`,
  });
}

// Best-effort wrapper: the post is already live, so a failing-translation-PR
// error is returned (surfaced in structuredContent) rather than thrown, keeping
// the successful publish honest instead of masking it as a failure.
async function ensureFailingTranslationPr(
  cfg: PublishConfig,
  input: { slug: string; title: string; translationPath: string; translation: { [key: string]: JsonValue } },
): Promise<string | undefined> {
  try {
    await openFailingTranslationPr(cfg, input);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const publishRecordSchema = z.object({
  mode: z.enum(["direct", "pilot"]),
  slug: z.string().optional(),
  pr: z.number().optional(),
  url: z.string().optional(),
});

// A pilot publish records its PR (number+url) once opened. A retry reads it back
// to short-circuit to the same honest "gestuur vir Joshua" success — mirroring
// how direct mode short-circuits via findDraftCommit — without re-hitting GitHub.
async function recordedPilotPr(
  ctx: ToolContext,
  draftId: string,
): Promise<{ pr: number; url: string } | null> {
  const raw = await ctx.store.getPublish(draftId);
  if (raw === null) {
    return null;
  }
  const parsed = publishRecordSchema.safeParse(raw);
  if (!parsed.success || parsed.data.mode !== "pilot" || parsed.data.url === undefined) {
    return null;
  }
  return { pr: parsed.data.pr ?? 0, url: parsed.data.url };
}

export function registerPublishTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "publish",
    {
      title: "Publiseer die resep",
      description:
        "Publiseer 'n goedgekeurde konsep (resep, bladsy-wysiging of webwerf-teks). Vereis 'n goedgekeurde voorskou en 'n Engelse vertaling.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om te publiseer."),
      },
    },
    async (args) => {
      const cfg = ctx.publishing;
      const content = ctx.content;
      if (cfg === undefined || content === undefined) {
        return fail("Publiseer is nie opgestel nie. Kontak Joshua.");
      }
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(`Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Kyk na list_drafts.`);
      }

      const approval = await ctx.store.getApproval(args.draftId);
      if (approval === null) {
        return fail(APPROVAL_REFUSAL, { draftId: args.draftId, approved: false });
      }

      if (stored.draft.kind === "chrome") {
        return publishChrome(ctx, cfg, content, stored.draft);
      }
      return publishPostOrPage(ctx, cfg, content, stored.draft);
    },
  );

  server.registerTool(
    "check_publish_status",
    {
      title: "Kyk hoe ver is die publikasie",
      description: "Gee die stand van 'n gepubliseerde konsep terug (besig, regstreeks, of wag vir goedkeuring).",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID wat gepubliseer is."),
      },
    },
    async (args) => {
      const cfg = ctx.publishing;
      if (cfg === undefined) {
        return fail("Publiseer is nie opgestel nie. Kontak Joshua.");
      }
      const branch = baseBranchOf(cfg);
      const rawRecord = await ctx.store.getPublish(args.draftId);
      const record = rawRecord === null ? null : publishRecordSchema.safeParse(rawRecord);
      const recordData = record !== null && record.success ? record.data : null;

      const landed = await cfg.github.findDraftCommit(args.draftId, branch);
      if (landed !== null) {
        const run = await cfg.github.latestRunForSha(landed);
        const slug = recordData?.slug;
        const liveUrl = slug !== undefined ? `${cfg.siteBaseUrl}/${slug}/` : cfg.siteBaseUrl;
        if (run === null || run.status !== "completed") {
          return ok("Jou pos is aanvaar en die ontplooiing is aan die gang — dit vat omtrent drie minute.", {
            draftId: args.draftId,
            status: "deploying",
          });
        }
        if (run.conclusion === "success") {
          return ok(`Jou pos is regstreeks! Kyk hier: ${liveUrl}`, {
            draftId: args.draftId,
            status: "live",
            url: liveUrl,
          });
        }
        if (run.conclusion === "cancelled") {
          return ok("Superseded — jou pos gaan saam met die volgende deploy uit. Niks is verkeerd nie.", {
            draftId: args.draftId,
            status: "superseded",
          });
        }
        return fail(
          `Iets het skeefgeloop met die ontplooiing (${run.conclusion ?? "onbekend"}). Sê asseblief vir ${reviewerOf(cfg)}.`,
          { draftId: args.draftId, status: "failed", url: run.url },
        );
      }

      if (recordData?.mode === "pilot") {
        return ok(
          `Jou pos wag nog vir ${reviewerOf(cfg)} se goedkeuring. Sodra hy dit goedkeur, gaan dit vanself regstreeks.${recordData.url !== undefined ? `\n${recordData.url}` : ""}`,
          { draftId: args.draftId, status: "awaiting-review", url: recordData.url },
        );
      }
      return ok("Ek kan nog geen gepubliseerde weergawe van hierdie konsep sien nie. Het jy dit al gepubliseer?", {
        draftId: args.draftId,
        status: "none",
      });
    },
  );

  server.registerTool(
    "delete_post",
    {
      title: "Verwyder 'n pos",
      description:
        "Verwyder 'n gepubliseerde pos of bladsy. Dit is onomkeerbaar en gaan ALTYD deur 'n PR vir Joshua se goedkeuring. Bevestig met confirm: true.",
      inputSchema: {
        slug: z.string().describe("Die pos/bladsy se URL-segment."),
        type: z.enum(["post", "page"]).optional().describe("«post» (verstek) of «page»."),
        confirm: z.boolean().optional().describe("Moet waar wees om die verwydering te bevestig."),
      },
    },
    async (args) => {
      const cfg = ctx.publishing;
      const content = ctx.content;
      if (cfg === undefined || content === undefined) {
        return fail("Verwyder is nie opgestel nie. Kontak Joshua.");
      }
      const type = args.type ?? "post";

      if (args.confirm !== true) {
        return fail(
          `Dit sal «${args.slug}» permanent verwyder. As jy seker is, roep delete_post weer met confirm: true — dan stuur ek 'n PR vir ${reviewerOf(cfg)}.`,
          { slug: args.slug, confirmed: false },
        );
      }

      const branch = baseBranchOf(cfg);
      const docPath = type === "page" ? `${PAGES_DIR}/${args.slug}.json` : `${POSTS_DIR}/${args.slug}.json`;
      const translationPath =
        type === "page"
          ? `${PAGE_TRANSLATIONS_DIR}/${args.slug}.json`
          : `${POST_TRANSLATIONS_DIR}/${args.slug}.json`;

      const exists =
        type === "page" ? (await content.loadPage(args.slug)) !== null : (await content.loadPost(args.slug)) !== null;
      if (!exists) {
        return fail(`Ek kon geen ${type === "page" ? "bladsy" : "pos"} met slug «${args.slug}» kry nie.`);
      }

      const deletions = [docPath];
      const translationState = await cfg.github.pathExists(translationPath, branch);
      if (translationState.exists) {
        deletions.push(translationPath);
      }

      const base = await cfg.github.getBaseTree(branch);
      const branchName = `cms/verwyder-${args.slug}`;
      await cfg.github.createBranch(branchName, base.commitSha);
      await cfg.github.commitFiles({
        files: [],
        deletions,
        message: `Verwyder ${type === "page" ? "bladsy" : "pos"}: ${args.slug}`,
        draftId: `verwyder-${args.slug}`,
        branch: branchName,
      });
      const pr = await openOrFindPr(cfg, {
        title: `Verwyder ${args.slug}`,
        head: branchName,
        base: branch,
        body: `${reviewerOf(cfg)}, hierdie PR verwyder «${args.slug}». Keur goed om dit te bevestig; niks word uitgevee voordat jy dit doen nie.`,
      });

      return ok(
        `Ek het 'n versoek gestuur om «${args.slug}» te verwyder. Dit gaan na ${reviewerOf(cfg)} vir goedkeuring — niks word uitgevee voordat hy dit goedkeur nie.\n${pr.url}`,
        { slug: args.slug, confirmed: true, pr: pr.number, url: pr.url },
      );
    },
  );
}
