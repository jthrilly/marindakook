import { GitHubError } from "./github";

// The error taxonomy behind the spec's guiding rule: "Marinda's draft is never
// lost, and she always gets an honest answer in Afrikaans." Two outcomes:
//
// - TRANSIENT (a passing network hiccup, or a 5xx that reached us WITHOUT the
//   GitHub client having exhausted its bounded internal retries): tell her to
//   try again in a minute. No alert — this is expected noise, not a broken
//   system.
// - TERMINAL (upstream auth 401/403, credit/rate exhaustion, GitHub still
//   failing after the client's retries are spent, or any unhandled fault): tell
//   her honestly that something on our side is broken and to ask Joshua, with a
//   short code — AND fire a direct alert to Joshua, because the Actions failure
//   email only ever covers CI, which never starts when the Worker itself fails.

export type ErrorKind = "transient" | "terminal";

export interface TaxonomyError {
  kind: ErrorKind;
  code: string;
  message: string;
}

// Where a terminal error is announced to Joshua. The webhook URL and fetch come
// from the Worker env so tests inject a mock; a missing URL simply skips the
// alert (the honest Afrikaans message is still returned).
export interface AlertConfig {
  webhookUrl?: string;
  fetch?: typeof fetch;
}

const TRANSIENT_MESSAGE =
  "Ek kon dit nou-nou nie klaarmaak nie — probeer asseblief oor 'n minuut weer.";

// Marinda-facing: plain Afrikaans, NO code. The short code lives on the
// TaxonomyError (for the Joshua alert + logs), never in her message.
function terminalMessage(): string {
  return `Iets is stukkend aan my kant — sê asseblief vir Joshua, dan kry ons dit reg.`;
}

export function transient(code: string): TaxonomyError {
  return { kind: "transient", code, message: TRANSIENT_MESSAGE };
}

async function fireJoshuaAlert(error: TaxonomyError, alert: AlertConfig): Promise<void> {
  if (alert.webhookUrl === undefined || alert.webhookUrl === "") {
    return;
  }
  const doFetch = alert.fetch ?? fetch;
  try {
    await doFetch(alert.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "marindakook-cms",
        code: error.code,
        message: error.message,
        at: new Date().toISOString(),
      }),
    });
  } catch {
    // Alerting must never throw into Marinda's path: if the webhook itself is
    // down she still gets the honest Afrikaans answer, just without the ping.
  }
}

export async function terminal(code: string, alert: AlertConfig): Promise<TaxonomyError> {
  const error: TaxonomyError = { kind: "terminal", code, message: terminalMessage() };
  await fireJoshuaAlert(error, alert);
  return error;
}

// The GitHub client retries transient statuses (429/5xx) internally, so a 5xx
// or 429 that reaches this layer marked `retriesExhausted` has already survived
// the client's bounded retries and is genuinely broken → terminal + alert
// Joshua. A 5xx that somehow arrives un-retried is still treated as a one-off
// blip → transient. Everything else — auth, credit/rate limits, and any error
// we do not recognise (an unhandled exception) — is terminal, so Joshua is
// always told when something is genuinely broken.
export function classify(error: unknown): ErrorKind {
  if (error instanceof GitHubError) {
    if (error.retriesExhausted) {
      return "terminal";
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return "transient";
    }
  }
  return "terminal";
}

export function codeFor(error: unknown): string {
  if (error instanceof GitHubError && typeof error.status === "number") {
    if (error.status === 401 || error.status === 403) {
      return "GH-AUTH";
    }
    if (error.status === 402 || error.status === 429) {
      return "GH-KREDIET";
    }
    if (error.status >= 500) {
      return "GH-5XX";
    }
    return `GH-${error.status}`;
  }
  return "INTERN";
}

// Single entry point the request/tool layer uses to turn any caught error into
// the taxonomy — classifying it and (for terminal) firing the Joshua alert.
export async function toTaxonomyError(error: unknown, alert: AlertConfig): Promise<TaxonomyError> {
  if (classify(error) === "transient") {
    return transient(codeFor(error));
  }
  return terminal(codeFor(error), alert);
}
