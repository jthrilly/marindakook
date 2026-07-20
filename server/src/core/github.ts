// GitHub App REST client for the publish pipeline. Everything (auth and every
// API call) flows through an injected `fetch`, so tests drive it with a mocked
// GitHub and no network. Authentication mints a short-lived installation token
// from a JWT signed with the App's RSA key via WebCrypto (the same code path in
// workerd tests and in production). Publishing is create-only for new files and
// idempotent via a `Draft-Id:` commit trailer.

const API_BASE = "https://api.github.com";
const USER_AGENT = "marindakook-cms";
const BLOB_MODE = "100644";
// GitHub trees list at most this many commits per page; we only need the most
// recent history to spot an already-landed publish.
const COMMIT_SCAN_PER_PAGE = 50;

export class GitHubError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "GitHubError";
    this.status = options?.status;
  }
}

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKeyPkcs8Pem: string;
  owner: string;
  repo: string;
  fetch: typeof fetch;
}

export interface CommitFile {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface CommitInput {
  files: CommitFile[];
  message: string;
  draftId: string;
  branch?: string;
  requireAbsent?: string[];
  expectShas?: Record<string, string>;
  // Paths to remove from the tree (a delete-commit sets the entry sha to null).
  // Used by delete_post's PR flow, which carries no new blobs.
  deletions?: string[];
}

export interface CommitResult {
  commitSha: string;
  superseded: boolean;
}

// A git tree entry. `sha: null` deletes the path (delete-commits); a string sha
// points at a blob.
interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}

export interface BaseTree {
  treeSha: string;
  commitSha: string;
}

export interface PathState {
  exists: boolean;
  sha?: string;
}

export interface PullRequestInput {
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface PullRequestResult {
  number: number;
  url: string;
}

export interface RunStatus {
  status: string;
  conclusion: string | null;
  url: string;
}

// The subset of the GitHub client the publish/status/delete tools depend on.
// `GitHubApp` implements it; tests inject a fake, so the tools type against the
// interface rather than the concrete class.
export interface GitHubClient {
  getBaseTree(ref: string): Promise<BaseTree>;
  pathExists(path: string, ref: string): Promise<PathState>;
  findDraftCommit(draftId: string, ref: string): Promise<string | null>;
  commitFiles(input: CommitInput): Promise<CommitResult>;
  createBranch(name: string, fromSha: string): Promise<void>;
  openPullRequest(input: PullRequestInput): Promise<PullRequestResult>;
  findOpenPullRequest(headBranch: string): Promise<PullRequestResult | null>;
  latestRunForSha(sha: string): Promise<RunStatus | null>;
}

export class GitHubApp implements GitHubClient {
  private readonly config: GitHubAppConfig;
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(config: GitHubAppConfig) {
    this.config = config;
  }

  async installationToken(now: number = Date.now()): Promise<string> {
    const jwt = await this.mintJwt(now);
    const res = await this.request(
      `/app/installations/${this.config.installationId}/access_tokens`,
      { method: "POST", token: jwt },
    );
    const body = await readJson(res, "access token");
    const record = readRecord(body, "access token");
    return readString(record.token, "access token .token");
  }

  async getBaseTree(ref: string): Promise<BaseTree> {
    const token = await this.installationToken();
    return this.getBaseTreeWith(token, ref);
  }

  async pathExists(path: string, ref: string): Promise<PathState> {
    const token = await this.installationToken();
    return this.pathExistsWith(token, path, ref);
  }

  async findDraftCommit(draftId: string, ref: string): Promise<string | null> {
    const token = await this.installationToken();
    return this.findDraftCommitWith(token, draftId, ref);
  }

  async commitFiles(input: CommitInput): Promise<CommitResult> {
    const branch = input.branch ?? "main";
    const token = await this.installationToken();

    // Idempotency: a prior attempt for this draft may already have landed (e.g.
    // the ref update succeeded but the response was lost). Returning that commit
    // avoids creating a duplicate.
    const existing = await this.findDraftCommitWith(token, input.draftId, branch);
    if (existing) {
      return { commitSha: existing, superseded: true };
    }

    const base = await this.getBaseTreeWith(token, branch);

    if ((input.requireAbsent && input.requireAbsent.length > 0) || input.expectShas) {
      await this.enforcePreconditions(token, base.treeSha, branch, input);
    }

    const blobEntries = await Promise.all(
      input.files.map(async (file) => ({
        path: file.path,
        mode: BLOB_MODE,
        type: "blob",
        sha: await this.createBlob(token, file),
      })),
    );
    const deletionEntries: TreeEntry[] = (input.deletions ?? []).map((path) => ({
      path,
      mode: BLOB_MODE,
      type: "blob",
      sha: null,
    }));
    const treeEntries: TreeEntry[] = [...blobEntries, ...deletionEntries];

    const newTreeSha = await this.createTree(token, base.treeSha, treeEntries);
    const message = withDraftTrailer(input.message, input.draftId);
    const commitSha = await this.createCommit(token, message, newTreeSha, [base.commitSha]);
    await this.updateRef(token, branch, commitSha);

    return { commitSha, superseded: false };
  }

  // Create a branch ref at `fromSha`. `commitFiles` only updates an EXISTING
  // ref, so the PR flows (pilot publish, delete_post) branch first. Idempotent:
  // a 422 means the ref already exists (a retried publish), which is fine.
  async createBranch(name: string, fromSha: string): Promise<void> {
    const token = await this.installationToken();
    await this.request(`/repos/${this.repoPath()}/git/refs`, {
      method: "POST",
      token,
      body: { ref: `refs/heads/${name}`, sha: fromSha },
      allowConflict: true,
    });
  }

  async openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
    const token = await this.installationToken();
    const res = await this.request(`/repos/${this.repoPath()}/pulls`, {
      method: "POST",
      token,
      body: { title: input.title, head: input.head, base: input.base, body: input.body ?? "" },
    });
    const record = readRecord(await readJson(res, "pull request"), "pull request");
    return {
      number: readNumber(record.number, "pull request .number"),
      url: readString(record.html_url, "pull request .html_url"),
    };
  }

  // Resolve the open PR for a head branch. Used to recover honestly from a
  // dropped `openPullRequest` response: on a retry GitHub answers the create
  // with a 422 "duplicate PR", and the caller falls back to this to return the
  // PR that already exists rather than surfacing a false failure.
  async findOpenPullRequest(headBranch: string): Promise<PullRequestResult | null> {
    const token = await this.installationToken();
    const head = `${this.config.owner}:${headBranch}`;
    const res = await this.request(
      `/repos/${this.repoPath()}/pulls?head=${encodeURIComponent(head)}&state=open`,
      { method: "GET", token },
    );
    const list = readArray(await readJson(res, "pull requests"), "pull requests");
    if (list.length === 0) {
      return null;
    }
    const record = readRecord(list[0], "pull request");
    return {
      number: readNumber(record.number, "pull request .number"),
      url: readString(record.html_url, "pull request .html_url"),
    };
  }

  async latestRunForSha(sha: string): Promise<RunStatus | null> {
    const token = await this.installationToken();
    const res = await this.request(
      `/repos/${this.repoPath()}/actions/runs?head_sha=${encodeURIComponent(sha)}`,
      { method: "GET", token },
    );
    const record = readRecord(await readJson(res, "workflow runs"), "workflow runs");
    const runs = readArray(record.workflow_runs, "workflow_runs");
    if (runs.length === 0) {
      return null;
    }
    const parsed = runs.map((run) => {
      const entry = readRecord(run, "workflow run");
      return {
        status: readString(entry.status, "workflow run .status"),
        conclusion: typeof entry.conclusion === "string" ? entry.conclusion : null,
        url: readString(entry.html_url, "workflow run .html_url"),
        createdAt: typeof entry.created_at === "string" ? entry.created_at : "",
      };
    });
    parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = parsed[0];
    return { status: latest.status, conclusion: latest.conclusion, url: latest.url };
  }

  private async getBaseTreeWith(token: string, ref: string): Promise<BaseTree> {
    const res = await this.request(`/repos/${this.repoPath()}/commits/${encodeURIComponent(ref)}`, {
      method: "GET",
      token,
    });
    const record = readRecord(await readJson(res, "commit"), "commit");
    const commit = readRecord(record.commit, "commit .commit");
    const tree = readRecord(commit.tree, "commit .commit.tree");
    return {
      commitSha: readString(record.sha, "commit .sha"),
      treeSha: readString(tree.sha, "commit .commit.tree.sha"),
    };
  }

  private async pathExistsWith(token: string, path: string, ref: string): Promise<PathState> {
    const res = await this.request(
      `/repos/${this.repoPath()}/contents/${encodeContentsPath(path)}?ref=${encodeURIComponent(ref)}`,
      { method: "GET", token, allowNotFound: true },
    );
    if (res.status === 404) {
      return { exists: false };
    }
    const record = readRecord(await readJson(res, "contents"), "contents");
    return { exists: true, sha: readString(record.sha, "contents .sha") };
  }

  private async findDraftCommitWith(
    token: string,
    draftId: string,
    ref: string,
  ): Promise<string | null> {
    const res = await this.request(
      `/repos/${this.repoPath()}/commits?sha=${encodeURIComponent(ref)}&per_page=${COMMIT_SCAN_PER_PAGE}`,
      { method: "GET", token },
    );
    const commits = readArray(await readJson(res, "commits"), "commits");
    const trailer = `Draft-Id: ${draftId}`;
    for (const item of commits) {
      const entry = readRecord(item, "commit list entry");
      const commit = readRecord(entry.commit, "commit list entry .commit");
      const message = readString(commit.message, "commit list entry .commit.message");
      if (message.split("\n").some((line) => line.trim() === trailer)) {
        return readString(entry.sha, "commit list entry .sha");
      }
    }
    return null;
  }

  private async enforcePreconditions(
    token: string,
    treeSha: string,
    branch: string,
    input: CommitInput,
  ): Promise<void> {
    const tree = await this.fetchTreeEntries(token, treeSha);

    const check = async (path: string): Promise<string | undefined> => {
      if (tree) {
        return tree.get(path);
      }
      // The base tree was truncated (very large repo), so membership from the
      // recursive listing is unreliable; fall back to a per-path lookup.
      const state = await this.pathExistsWith(token, path, branch);
      return state.exists ? state.sha : undefined;
    };

    for (const path of input.requireAbsent ?? []) {
      const sha = await check(path);
      if (sha !== undefined) {
        throw new GitHubError(
          `Create-only publish collision: ${path} already exists on ${branch}`,
        );
      }
    }

    for (const [path, expected] of Object.entries(input.expectShas ?? {})) {
      const actual = await check(path);
      if (actual === undefined) {
        throw new GitHubError(`Expected ${path} to exist on ${branch} for update, but it is absent`);
      }
      if (actual !== expected) {
        throw new GitHubError(
          `Stale update for ${path}: expected blob ${expected}, found ${actual}`,
        );
      }
    }
  }

  private async fetchTreeEntries(
    token: string,
    treeSha: string,
  ): Promise<Map<string, string> | null> {
    const res = await this.request(
      `/repos/${this.repoPath()}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      { method: "GET", token },
    );
    const record = readRecord(await readJson(res, "tree"), "tree");
    if (record.truncated === true) {
      return null;
    }
    const entries = readArray(record.tree, "tree .tree");
    const map = new Map<string, string>();
    for (const item of entries) {
      const entry = readRecord(item, "tree entry");
      const path = readString(entry.path, "tree entry .path");
      map.set(path, typeof entry.sha === "string" ? entry.sha : "");
    }
    return map;
  }

  private async createBlob(token: string, file: CommitFile): Promise<string> {
    const res = await this.request(`/repos/${this.repoPath()}/git/blobs`, {
      method: "POST",
      token,
      body: { content: file.content, encoding: file.encoding ?? "utf-8" },
    });
    const record = readRecord(await readJson(res, "blob"), "blob");
    return readString(record.sha, "blob .sha");
  }

  private async createTree(
    token: string,
    baseTreeSha: string,
    entries: TreeEntry[],
  ): Promise<string> {
    const res = await this.request(`/repos/${this.repoPath()}/git/trees`, {
      method: "POST",
      token,
      body: { base_tree: baseTreeSha, tree: entries },
    });
    const record = readRecord(await readJson(res, "tree create"), "tree create");
    return readString(record.sha, "tree create .sha");
  }

  private async createCommit(
    token: string,
    message: string,
    treeSha: string,
    parents: string[],
  ): Promise<string> {
    const res = await this.request(`/repos/${this.repoPath()}/git/commits`, {
      method: "POST",
      token,
      body: { message, tree: treeSha, parents },
    });
    const record = readRecord(await readJson(res, "commit create"), "commit create");
    return readString(record.sha, "commit create .sha");
  }

  private async updateRef(token: string, branch: string, commitSha: string): Promise<void> {
    await this.request(`/repos/${this.repoPath()}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      token,
      body: { sha: commitSha, force: false },
    });
  }

  private repoPath(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  private async request(
    path: string,
    options: {
      method: string;
      token: string;
      body?: unknown;
      allowNotFound?: boolean;
      allowConflict?: boolean;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${options.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await this.config.fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const tolerated =
      (options.allowNotFound === true && res.status === 404) ||
      (options.allowConflict === true && res.status === 422);
    if (!res.ok && !tolerated) {
      const detail = await safeText(res);
      throw new GitHubError(`GitHub ${options.method} ${path} failed: ${res.status} ${detail}`, {
        status: res.status,
      });
    }
    return res;
  }

  private importKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      const der = pemToDer(this.config.privateKeyPkcs8Pem);
      this.keyPromise = crypto.subtle.importKey(
        "pkcs8",
        der,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    }
    return this.keyPromise;
  }

  private async mintJwt(now: number): Promise<string> {
    const issuedAt = Math.floor(now / 1000) - 60;
    const header = base64UrlEncode(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = base64UrlEncode(
      utf8(JSON.stringify({ iat: issuedAt, exp: issuedAt + 660, iss: this.config.appId })),
    );
    const signingInput = `${header}.${payload}`;
    const key = await this.importKey();
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      utf8(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }
}

function withDraftTrailer(message: string, draftId: string): string {
  return `${message.replace(/\s+$/, "")}\n\nDraft-Id: ${draftId}\n`;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) der[i] = binary.charCodeAt(i);
  return der;
}

function encodeContentsPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

async function readJson(res: Response, context: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new GitHubError(`Unexpected GitHub response: ${context} body was not JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GitHubError(`Unexpected GitHub response: ${context} was not an object`);
  }
  return value;
}

function readArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new GitHubError(`Unexpected GitHub response: ${context} was not an array`);
  }
  return value;
}

function readString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new GitHubError(`Unexpected GitHub response: ${context} was not a string`);
  }
  return value;
}

function readNumber(value: unknown, context: string): number {
  if (typeof value !== "number") {
    throw new GitHubError(`Unexpected GitHub response: ${context} was not a number`);
  }
  return value;
}
