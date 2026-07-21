import { beforeAll, describe, expect, it } from "vitest";
import { GitHubApp, GitHubError } from "../src/core/github";

// The App's RSA key is generated for real inside workerd so signing exercises
// the same WebCrypto path production uses; the public half stays around to
// verify the minted JWT's signature end-to-end.
let keyPair: CryptoKeyPair;
let privateKeyPkcs8Pem: string;

beforeAll(async () => {
  const generated = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in generated)) throw new Error("expected an RSA key pair");
  keyPair = generated;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  if (!(pkcs8 instanceof ArrayBuffer)) throw new Error("expected pkcs8 ArrayBuffer");
  privateKeyPkcs8Pem = toPkcs8Pem(pkcs8);
});

const OWNER = "marinda";
const REPO = "site";
const INSTALLATION_ID = "123";
const APP_ID = "42";
const FIXED_NOW = 1_700_000_000_000;

interface RecordedCall {
  method: string;
  pathname: string;
  search: string;
  headers: Headers;
  body: unknown;
}

type Route = (call: RecordedCall) => Response | Promise<Response> | undefined;

function makeFetch(route: Route): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(urlOf(input));
    const rawBody = init?.body;
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      headers: new Headers(init?.headers),
      body: typeof rawBody === "string" && rawBody.length > 0 ? JSON.parse(rawBody) : undefined,
    };
    calls.push(call);
    const response = await route(call);
    if (!response) {
      throw new Error(`unrouted request: ${call.method} ${url.pathname}`);
    }
    return response;
  };
  return { fetch: fetchImpl, calls };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function newApp(fetchImpl: typeof fetch, sleep?: (ms: number) => Promise<void>): GitHubApp {
  return new GitHubApp({
    appId: APP_ID,
    installationId: INSTALLATION_ID,
    privateKeyPkcs8Pem,
    owner: OWNER,
    repo: REPO,
    fetch: fetchImpl,
    sleep,
  });
}

// Zero-delay sleep so the retry-backoff tests stay fast and deterministic.
const zeroSleep = async (): Promise<void> => {};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function toPkcs8Pem(der: ArrayBuffer): string {
  const b64 = bytesToBase64(new Uint8Array(der));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64UrlToBytes(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("installationToken", () => {
  it("posts a signed RS256 JWT to the installation endpoint and returns the token", async () => {
    let capturedAuth: string | null = null;
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (
        call.method === "POST" &&
        call.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`
      ) {
        capturedAuth = call.headers.get("authorization");
        return json({ token: "ghs_installtoken", expires_at: "2026-07-20T18:00:00Z" });
      }
      return undefined;
    });

    const token = await newApp(fetchImpl).installationToken(FIXED_NOW);

    expect(token).toBe("ghs_installtoken");
    expect(calls).toHaveLength(1);
    expect(capturedAuth).toMatch(/^Bearer /);

    const jwt = capturedAuth!.slice("Bearer ".length);
    const segments = jwt.split(".");
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    const header = decodeSegment(segments[0]);
    const payload = decodeSegment(segments[1]);
    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload).toMatchObject({ iss: APP_ID });
    if (!isRecord(payload)) throw new Error("payload not an object");
    expect(payload.iat).toBe(Math.floor(FIXED_NOW / 1000) - 60);
    expect(payload.exp).toBe(Math.floor(FIXED_NOW / 1000) + 600);

    const verified = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      keyPair.publicKey,
      base64UrlToBytes(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    expect(verified).toBe(true);
  });

  // Regression: the Workers runtime throws "Illegal invocation" when native
  // `fetch` is called with a receiver other than the global scope, so `request`
  // must invoke the injected fetch as a bare reference — never `this.config.fetch(...)`.
  // A regular (non-arrow) function captures the call-site `this`; a bare call in
  // a strict ES module passes `this` as undefined.
  it("invokes the injected fetch without a receiver (no Illegal invocation)", async () => {
    let capturedThis: unknown = "unset";
    const fetchImpl = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      capturedThis = this;
      return Promise.resolve(json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" }));
    } as typeof fetch;

    await newApp(fetchImpl).installationToken(FIXED_NOW);

    expect(capturedThis).toBeUndefined();
  });
});

describe("commitFiles create-only", () => {
  const baseTreeSha = "basetree1";
  const parentSha = "parentcommit1";

  function routeCreate(treeEntries: { path: string }[]): {
    fetch: typeof fetch;
    calls: RecordedCall[];
  } {
    return makeFetch((call) => {
      const { method, pathname } = call;
      if (method === "POST" && pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (method === "GET" && pathname === `/repos/${OWNER}/${REPO}/commits`) {
        return json([]);
      }
      if (method === "GET" && pathname === `/repos/${OWNER}/${REPO}/commits/main`) {
        return json({ sha: parentSha, commit: { tree: { sha: baseTreeSha } } });
      }
      if (method === "GET" && pathname === `/repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}`) {
        return json({ sha: baseTreeSha, truncated: false, tree: treeEntries });
      }
      if (method === "POST" && pathname === `/repos/${OWNER}/${REPO}/git/blobs`) {
        return json({ sha: "blob1" });
      }
      if (method === "POST" && pathname === `/repos/${OWNER}/${REPO}/git/trees`) {
        return json({ sha: "newtree1" });
      }
      if (method === "POST" && pathname === `/repos/${OWNER}/${REPO}/git/commits`) {
        return json({ sha: "newcommit1" });
      }
      if (method === "PATCH" && pathname === `/repos/${OWNER}/${REPO}/git/refs/heads/main`) {
        return json({ object: { sha: "newcommit1" } });
      }
      return undefined;
    });
  }

  it("runs blob→tree→commit→ref and embeds the Draft-Id trailer", async () => {
    const { fetch: fetchImpl, calls } = routeCreate([{ path: "content/posts/other.json" }]);

    const result = await newApp(fetchImpl).commitFiles({
      files: [{ path: "content/posts/new.json", content: '{"title":"Nuwe"}' }],
      message: "Publiseer Nuwe resep",
      draftId: "draft-42",
      requireAbsent: ["content/posts/new.json"],
    });

    expect(result).toEqual({ commitSha: "newcommit1", superseded: false });

    expect(calls.map((c) => `${c.method} ${c.pathname}`)).toEqual([
      `POST /app/installations/${INSTALLATION_ID}/access_tokens`,
      `GET /repos/${OWNER}/${REPO}/commits`,
      `GET /repos/${OWNER}/${REPO}/commits/main`,
      `GET /repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}`,
      `POST /repos/${OWNER}/${REPO}/git/blobs`,
      `POST /repos/${OWNER}/${REPO}/git/trees`,
      `POST /repos/${OWNER}/${REPO}/git/commits`,
      `PATCH /repos/${OWNER}/${REPO}/git/refs/heads/main`,
    ]);

    const treeCall = calls.find((c) => c.pathname.endsWith("/git/trees") && c.method === "POST");
    expect(treeCall?.body).toMatchObject({ base_tree: baseTreeSha });

    const commitCall = calls.find((c) => c.pathname.endsWith("/git/commits") && c.method === "POST");
    if (!commitCall || !isRecord(commitCall.body)) throw new Error("missing commit body");
    const commitBody = commitCall.body;
    expect(commitBody.parents).toEqual([parentSha]);
    expect(commitBody.tree).toBe("newtree1");
    expect(typeof commitBody.message).toBe("string");
    expect(String(commitBody.message)).toContain("\nDraft-Id: draft-42");
  });

  it("throws a create-collision error when a requireAbsent path already exists", async () => {
    const { fetch: fetchImpl, calls } = routeCreate([{ path: "content/posts/new.json" }]);

    await expect(
      newApp(fetchImpl).commitFiles({
        files: [{ path: "content/posts/new.json", content: "{}" }],
        message: "Publiseer",
        draftId: "draft-99",
        requireAbsent: ["content/posts/new.json"],
      }),
    ).rejects.toThrowError(GitHubError);

    expect(calls.some((c) => c.method === "POST" && c.pathname.endsWith("/git/commits"))).toBe(
      false,
    );
  });
});

describe("createBranch", () => {
  it("POSTs a fully-qualified ref at the given sha", async () => {
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (call.method === "POST" && call.pathname === `/repos/${OWNER}/${REPO}/git/refs`) {
        return json({ ref: "refs/heads/cms/publiseer-d1" }, 201);
      }
      return undefined;
    });

    await newApp(fetchImpl).createBranch("cms/publiseer-d1", "parentsha");

    const refCall = calls.find((c) => c.pathname.endsWith("/git/refs"));
    expect(refCall?.body).toEqual({ ref: "refs/heads/cms/publiseer-d1", sha: "parentsha" });
  });

  it("tolerates a 422 (the ref already exists) so a retry is idempotent", async () => {
    const fetchImpl = makeFetch((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (call.method === "POST" && call.pathname === `/repos/${OWNER}/${REPO}/git/refs`) {
        return json({ message: "Reference already exists" }, 422);
      }
      return undefined;
    }).fetch;

    await expect(newApp(fetchImpl).createBranch("cms/publiseer-d1", "parentsha")).resolves.toBeUndefined();
  });
});

describe("commitFiles deletions", () => {
  it("emits a null-sha tree entry for each deleted path (no blob created)", async () => {
    const baseTreeSha = "basetree1";
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      const { method, pathname } = call;
      if (method === "POST" && pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (method === "GET" && pathname === `/repos/${OWNER}/${REPO}/commits`) {
        return json([]);
      }
      if (method === "GET" && pathname === `/repos/${OWNER}/${REPO}/commits/main`) {
        return json({ sha: "parentcommit1", commit: { tree: { sha: baseTreeSha } } });
      }
      if (method === "POST" && pathname === `/repos/${OWNER}/${REPO}/git/trees`) {
        return json({ sha: "newtree1" });
      }
      if (method === "POST" && pathname === `/repos/${OWNER}/${REPO}/git/commits`) {
        return json({ sha: "newcommit1" });
      }
      if (method === "PATCH" && pathname === `/repos/${OWNER}/${REPO}/git/refs/heads/main`) {
        return json({ object: { sha: "newcommit1" } });
      }
      return undefined;
    });

    const result = await newApp(fetchImpl).commitFiles({
      files: [],
      deletions: ["content/posts/gone.json", "content/translations/en/posts/gone.json"],
      message: "Vee resep uit",
      draftId: "draft-del",
    });

    expect(result.commitSha).toBe("newcommit1");
    expect(calls.some((c) => c.method === "POST" && c.pathname.endsWith("/git/blobs"))).toBe(false);

    const treeCall = calls.find((c) => c.pathname.endsWith("/git/trees") && c.method === "POST");
    if (!treeCall || !isRecord(treeCall.body)) throw new Error("missing tree body");
    expect(treeCall.body.tree).toEqual([
      { path: "content/posts/gone.json", mode: "100644", type: "blob", sha: null },
      { path: "content/translations/en/posts/gone.json", mode: "100644", type: "blob", sha: null },
    ]);
  });
});

describe("findOpenPullRequest", () => {
  it("queries the head-scoped open PR and returns its number/url", async () => {
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (call.method === "GET" && call.pathname === `/repos/${OWNER}/${REPO}/pulls`) {
        return json([{ number: 7, html_url: "https://github.com/marinda/site/pull/7" }]);
      }
      return undefined;
    });

    const result = await newApp(fetchImpl).findOpenPullRequest("cms/publiseer-d1");

    expect(result).toEqual({ number: 7, url: "https://github.com/marinda/site/pull/7" });
    const pullsCall = calls.find((c) => c.pathname === `/repos/${OWNER}/${REPO}/pulls`);
    expect(pullsCall?.search).toContain(`head=${encodeURIComponent(`${OWNER}:cms/publiseer-d1`)}`);
    expect(pullsCall?.search).toContain("state=open");
  });

  it("returns null when no open PR exists for the head", async () => {
    const fetchImpl = makeFetch((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (call.method === "GET" && call.pathname === `/repos/${OWNER}/${REPO}/pulls`) {
        return json([]);
      }
      return undefined;
    }).fetch;

    expect(await newApp(fetchImpl).findOpenPullRequest("cms/publiseer-none")).toBeNull();
  });
});

describe("findDraftCommit", () => {
  function routeCommits(commits: { sha: string; message: string }[]): typeof fetch {
    return makeFetch((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/access_tokens")) {
        return json({ token: "ghs_x", expires_at: "2026-07-20T18:00:00Z" });
      }
      if (call.method === "GET" && call.pathname === `/repos/${OWNER}/${REPO}/commits`) {
        return json(commits.map((c) => ({ sha: c.sha, commit: { message: c.message } })));
      }
      return undefined;
    }).fetch;
  }

  it("returns the SHA of a recent commit carrying the Draft-Id trailer", async () => {
    const fetchImpl = routeCommits([
      { sha: "aaa", message: "Iets anders" },
      { sha: "bbb", message: "Publiseer Nuwe resep\n\nDraft-Id: draft-42\n" },
    ]);
    const sha = await newApp(fetchImpl).findDraftCommit("draft-42", "main");
    expect(sha).toBe("bbb");
  });

  it("returns null when no commit carries the trailer", async () => {
    const fetchImpl = routeCommits([{ sha: "aaa", message: "Publiseer\n\nDraft-Id: draft-1\n" }]);
    const sha = await newApp(fetchImpl).findDraftCommit("draft-42", "main");
    expect(sha).toBeNull();
  });
});

describe("request retries transient faults with backoff", () => {
  const tokenPath = `/app/installations/${INSTALLATION_ID}/access_tokens`;

  it("retries a transient 503 and succeeds on a later attempt", async () => {
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (call.method === "POST" && call.pathname === tokenPath) {
        // First attempt is a 503; the retry succeeds.
        return calls.length === 1
          ? new Response("upstream boom", { status: 503 })
          : json({ token: "ghs_retry_ok", expires_at: "2026-07-20T18:00:00Z" });
      }
      return undefined;
    });

    const token = await newApp(fetchImpl, zeroSleep).installationToken(FIXED_NOW);

    expect(token).toBe("ghs_retry_ok");
    expect(calls.length).toBe(2);
  });

  it("exhausts the bound on a persistent 503 and marks the error retriesExhausted", async () => {
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (call.method === "POST" && call.pathname === tokenPath) {
        return new Response("still boom", { status: 503 });
      }
      return undefined;
    });

    let caught: unknown;
    try {
      await newApp(fetchImpl, zeroSleep).installationToken(FIXED_NOW);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GitHubError);
    if (!(caught instanceof GitHubError)) throw new Error("expected a GitHubError");
    expect(caught.retriesExhausted).toBe(true);
    expect(caught.status).toBe(503);
    expect(calls.length).toBe(3);
  });

  it("does not retry a non-transient 403 — throws immediately after one call", async () => {
    const { fetch: fetchImpl, calls } = makeFetch((call) => {
      if (call.method === "POST" && call.pathname === tokenPath) {
        return new Response("forbidden", { status: 403 });
      }
      return undefined;
    });

    let caught: unknown;
    try {
      await newApp(fetchImpl, zeroSleep).installationToken(FIXED_NOW);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GitHubError);
    if (!(caught instanceof GitHubError)) throw new Error("expected a GitHubError");
    expect(caught.retriesExhausted).toBe(false);
    expect(caught.status).toBe(403);
    expect(calls.length).toBe(1);
  });
});
