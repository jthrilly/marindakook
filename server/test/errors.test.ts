import { describe, expect, it, vi } from "vitest";
import { classify, codeFor, terminal, toTaxonomyError, transient } from "../src/core/errors";
import { GitHubError } from "../src/core/github";

const WEBHOOK = "https://alerts.example/joshua";

function mockAlert() {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  return { webhookUrl: WEBHOOK, fetch: fetchMock };
}

describe("error taxonomy", () => {
  it("transient returns the Afrikaans retry message and never alerts", () => {
    const error = transient("GH-5XX");
    expect(error.kind).toBe("transient");
    expect(error.message).toContain("probeer");
    expect(error.message).toContain("minuut");
  });

  it("terminal returns the honest 'sê vir Joshua' message with a code and fires the alert", async () => {
    const alert = mockAlert();
    const error = await terminal("GH-AUTH", alert);
    expect(error.kind).toBe("terminal");
    expect(error.message).toContain("sê asseblief vir Joshua");
    // The code is captured for the alert/logs, but NOT shown in Marinda's message.
    expect(error.code).toBe("GH-AUTH");
    expect(error.message).not.toContain("GH-AUTH");
    expect(alert.fetch).toHaveBeenCalledTimes(1);
    expect(alert.fetch).toHaveBeenCalledWith(WEBHOOK, expect.objectContaining({ method: "POST" }));
  });

  it("terminal without a webhook still returns the message, no alert attempted", async () => {
    const error = await terminal("INTERN", {});
    expect(error.kind).toBe("terminal");
    expect(error.message).toContain("Joshua");
  });

  it("a broken webhook never throws into the caller's path", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("webhook af");
    });
    const error = await terminal("GH-AUTH", { webhookUrl: WEBHOOK, fetch: fetchMock });
    expect(error.kind).toBe("terminal");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a GitHub 5xx as transient, auth/credit/unknown as terminal", () => {
    expect(classify(new GitHubError("boom", { status: 500 }))).toBe("transient");
    expect(classify(new GitHubError("boom", { status: 503 }))).toBe("transient");
    expect(classify(new GitHubError("nope", { status: 403 }))).toBe("terminal");
    expect(classify(new GitHubError("nope", { status: 429 }))).toBe("terminal");
    expect(classify(new Error("iets onbekend"))).toBe("terminal");
  });

  it("classifies a retriesExhausted GitHubError as terminal — the client already retried", () => {
    expect(classify(new GitHubError("still 5xx", { status: 503, retriesExhausted: true }))).toBe(
      "terminal",
    );
    expect(classify(new GitHubError("still 429", { status: 429, retriesExhausted: true }))).toBe(
      "terminal",
    );
  });

  it("escalates an exhausted 5xx to a terminal Joshua alert via toTaxonomyError", async () => {
    const alert = mockAlert();
    const result = await toTaxonomyError(
      new GitHubError("upstream down", { status: 503, retriesExhausted: true }),
      alert,
    );
    expect(result.kind).toBe("terminal");
    expect(result.message).toContain("sê asseblief vir Joshua");
    expect(result.code).toBe("GH-5XX");
    expect(alert.fetch).toHaveBeenCalledTimes(1);
  });

  it("derives short stable codes from GitHub status", () => {
    expect(codeFor(new GitHubError("x", { status: 401 }))).toBe("GH-AUTH");
    expect(codeFor(new GitHubError("x", { status: 403 }))).toBe("GH-AUTH");
    expect(codeFor(new GitHubError("x", { status: 429 }))).toBe("GH-KREDIET");
    expect(codeFor(new GitHubError("x", { status: 502 }))).toBe("GH-5XX");
    expect(codeFor(new Error("x"))).toBe("INTERN");
  });

  it("toTaxonomyError alerts on a terminal fault only", async () => {
    const terminalAlert = mockAlert();
    const terminalResult = await toTaxonomyError(new GitHubError("auth", { status: 403 }), terminalAlert);
    expect(terminalResult.kind).toBe("terminal");
    expect(terminalResult.code).toBe("GH-AUTH");
    expect(terminalAlert.fetch).toHaveBeenCalledTimes(1);

    const transientAlert = mockAlert();
    const transientResult = await toTaxonomyError(new GitHubError("5xx", { status: 500 }), transientAlert);
    expect(transientResult.kind).toBe("transient");
    expect(transientAlert.fetch).not.toHaveBeenCalled();
  });
});
