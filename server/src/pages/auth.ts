import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// The Afrikaans login page and the glue that completes an OAuth authorization.
// The Worker's OAuthProvider handles all token machinery; the only thing left
// to the application is (1) a UI to collect a username/password and (2) calling
// `completeAuthorization` once the credentials check out. There are exactly two
// accounts — Marinda and Joshua — read from env secrets, so "password reset" is
// simply Joshua updating a secret, never an incident (spec §295-304).

// The two account credentials, read from env secrets (spec §295-304). Kept
// separate from `AuthEnv` so credential checks are unit-testable without
// stubbing the whole OAuthHelpers surface.
export interface AuthCredentials {
  OAUTH_MARINDA_USERNAME?: string;
  OAUTH_MARINDA_PASSWORD?: string;
  OAUTH_JOSHUA_USERNAME?: string;
  OAUTH_JOSHUA_PASSWORD?: string;
}

// The full env the OAuth flow needs: the credentials plus the `OAUTH_PROVIDER`
// helpers the library injects into the handler at request time.
export interface AuthEnv extends AuthCredentials {
  OAUTH_PROVIDER: OAuthHelpers;
}

export interface Account {
  userId: string;
  username: string;
  password: string;
}

function accountsFrom(credentials: AuthCredentials): Account[] {
  const accounts: Account[] = [];
  if (credentials.OAUTH_MARINDA_USERNAME && credentials.OAUTH_MARINDA_PASSWORD) {
    accounts.push({
      userId: "marinda",
      username: credentials.OAUTH_MARINDA_USERNAME,
      password: credentials.OAUTH_MARINDA_PASSWORD,
    });
  }
  if (credentials.OAUTH_JOSHUA_USERNAME && credentials.OAUTH_JOSHUA_PASSWORD) {
    accounts.push({
      userId: "joshua",
      username: credentials.OAUTH_JOSHUA_USERNAME,
      password: credentials.OAUTH_JOSHUA_PASSWORD,
    });
  }
  return accounts;
}

const encoder = new TextEncoder();

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index] ^ bBytes[index];
  }
  return diff === 0;
}

export function verifyCredentials(
  credentials: AuthCredentials,
  username: string,
  password: string,
): Account | null {
  let matched: Account | null = null;
  // Evaluate every account (no early return) so a caller cannot infer which
  // usernames exist from response timing.
  for (const account of accountsFrom(credentials)) {
    const usernameOk = constantTimeStringEqual(account.username, username);
    const passwordOk = constantTimeStringEqual(account.password, password);
    if (usernameOk && passwordOk) {
      matched = account;
    }
  }
  return matched;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const LOGIN_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; padding: 1.5rem; max-width: 26rem; margin-inline: auto; }
h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
p.intro { margin: 0 0 1.5rem; color: #69574f; }
label { display: block; font-weight: 600; margin: 1rem 0 0.35rem; }
input { width: 100%; padding: 0.75rem 0.85rem; font-size: 1.05rem; border: 1px solid #d8c8bf; border-radius: 0.6rem; background: #fff; color: #222; }
button { margin-top: 1.5rem; width: 100%; padding: 0.9rem 1.4rem; font-size: 1.1rem; font-weight: 600; color: #fff; background: #f34d47; border: none; border-radius: 0.75rem; cursor: pointer; }
.fout { margin-top: 1rem; padding: 0.75rem 1rem; border-radius: 0.5rem; background: rgba(192, 57, 43, 0.12); border: 1px solid #c0392b; color: #c0392b; }
`;

export interface LoginPageOptions {
  oauthState?: string;
  error?: string;
}

export function renderLoginPage(options: LoginPageOptions = {}): Response {
  const oauthField =
    options.oauthState !== undefined && options.oauthState !== ""
      ? `<input type="hidden" name="oauth_request" value="${escapeHtml(options.oauthState)}">`
      : "";
  const errorBlock =
    options.error !== undefined ? `<p class="fout" role="alert">${escapeHtml(options.error)}</p>` : "";
  const html = `<!doctype html>
<html lang="af">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meld aan — Marinda kook</title>
<style>${LOGIN_CSS}</style>
</head>
<body>
<h1>Meld aan</h1>
<p class="intro">Meld aan om met Marinda kook se resepte te werk.</p>
${errorBlock}
<form method="post" autocomplete="off">
${oauthField}
<label for="gebruikersnaam">Gebruikersnaam</label>
<input id="gebruikersnaam" name="username" type="text" autocapitalize="none" autocomplete="username" required>
<label for="wagwoord">Wagwoord</label>
<input id="wagwoord" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Meld aan</button>
</form>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// The AuthRequest is threaded through the login form as a base64 blob so the
// POST — which is a plain form submission, not an OAuth request — can hand the
// exact original request back to `completeAuthorization`.
function encodeAuthRequest(request: AuthRequest): string {
  return btoa(encodeURIComponent(JSON.stringify(request)));
}

function decodeAuthRequest(value: string): AuthRequest | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(value)));
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const record: Record<string, unknown> = { ...parsed };
    if (typeof record.clientId !== "string" || typeof record.redirectUri !== "string") {
      return null;
    }
    if (!Array.isArray(record.scope) || typeof record.state !== "string") {
      return null;
    }
    return {
      responseType: typeof record.responseType === "string" ? record.responseType : "code",
      clientId: record.clientId,
      redirectUri: record.redirectUri,
      scope: record.scope.filter((entry): entry is string => typeof entry === "string"),
      state: record.state,
      codeChallenge: typeof record.codeChallenge === "string" ? record.codeChallenge : undefined,
      codeChallengeMethod:
        typeof record.codeChallengeMethod === "string" ? record.codeChallengeMethod : undefined,
      resource: typeof record.resource === "string" ? record.resource : undefined,
    };
  } catch {
    return null;
  }
}

async function renderAuthorizeForm(request: Request, env: AuthEnv): Promise<Response> {
  let oauthState = "";
  try {
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    if (authRequest.clientId !== "") {
      oauthState = encodeAuthRequest(authRequest);
    }
  } catch {
    // No/invalid OAuth parameters (e.g. a bare /login visit): still show the
    // form so the page is reachable; a submission without an OAuth request is
    // handled honestly below.
  }
  return renderLoginPage({ oauthState });
}

async function handleAuthorizeSubmit(request: Request, env: AuthEnv): Promise<Response> {
  const form = await request.formData();
  const username = typeof form.get("username") === "string" ? String(form.get("username")) : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const oauthState = typeof form.get("oauth_request") === "string" ? String(form.get("oauth_request")) : "";

  const account = verifyCredentials(env, username, password);
  if (account === null) {
    return renderLoginPage({ oauthState, error: "Verkeerde gebruikersnaam of wagwoord. Probeer weer." });
  }

  const authRequest = oauthState === "" ? null : decodeAuthRequest(oauthState);
  if (authRequest === null) {
    // Correct credentials but no OAuth request to complete (a direct /login):
    // there is nothing to grant. Tell her to start from her chat connection.
    return renderLoginPage({
      error: "Meld asseblief aan vanuit jou gesprek-verbinding sodat ek jou kan koppel.",
    });
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: account.userId,
    metadata: { label: account.username },
    scope: authRequest.scope.length > 0 ? authRequest.scope : ["cms"],
    props: { userId: account.userId, username: account.username },
  });
  return Response.redirect(redirectTo, 302);
}

export async function handleAuthorize(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method === "GET") {
    return renderAuthorizeForm(request, env);
  }
  if (request.method === "POST") {
    return handleAuthorizeSubmit(request, env);
  }
  return new Response("Metode nie toegelaat nie.", { status: 405 });
}
