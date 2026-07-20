import { describe, expect, it } from "vitest";
import { renderLoginPage, verifyCredentials, type AuthCredentials } from "../src/pages/auth";

const CREDENTIALS: AuthCredentials = {
  OAUTH_MARINDA_USERNAME: "marinda",
  OAUTH_MARINDA_PASSWORD: "geheim-marinda",
  OAUTH_JOSHUA_USERNAME: "joshua",
  OAUTH_JOSHUA_PASSWORD: "geheim-joshua",
};

describe("login page", () => {
  it("renders an Afrikaans login form (200)", async () => {
    const response = renderLoginPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('lang="af"');
    expect(html).toContain("Meld aan");
    expect(html).toContain("Gebruikersnaam");
    expect(html).toContain("Wagwoord");
  });

  it("shows an Afrikaans error and preserves the oauth state when asked", async () => {
    const html = await renderLoginPage({ oauthState: "abc123", error: "Verkeerde gebruikersnaam of wagwoord." }).text();
    expect(html).toContain("Verkeerde gebruikersnaam of wagwoord.");
    expect(html).toContain('name="oauth_request" value="abc123"');
  });
});

describe("verifyCredentials", () => {
  it("accepts either correct account", () => {
    expect(verifyCredentials(CREDENTIALS, "marinda", "geheim-marinda")?.userId).toBe("marinda");
    expect(verifyCredentials(CREDENTIALS, "joshua", "geheim-joshua")?.userId).toBe("joshua");
  });

  it("rejects a wrong password", () => {
    expect(verifyCredentials(CREDENTIALS, "marinda", "verkeerd")).toBeNull();
  });

  it("rejects an unknown username", () => {
    expect(verifyCredentials(CREDENTIALS, "iemand-anders", "geheim-marinda")).toBeNull();
  });

  it("rejects when no accounts are configured", () => {
    expect(verifyCredentials({}, "marinda", "geheim-marinda")).toBeNull();
  });
});
