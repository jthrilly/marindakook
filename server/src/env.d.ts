// Ambient Env binding type for the Worker. Bindings are declared (commented)
// in wrangler.toml and provided to tests by miniflare in vitest.config.ts.
// Secrets are set with `wrangler secret put` at provisioning time (spec D11);
// tests supply fakes via miniflare `bindings`.
//
// `Cloudflare.Env` is the workers-types hook other ambient declarations key
// off (e.g. `cloudflare:workers`'s `env` export, used by store tests). It
// starts as an empty interface upstream; merging our bindings into it here
// — the same shape `wrangler types` would generate — means both the global
// `Env` used by the fetch handler and the test-time `env` import see the
// same binding types, with no `as` casts on either side.
//
// The OAuthHelpers type is referenced via an inline `import(...)` type so this
// file stays an ambient (non-module) declaration — a top-level `import`
// statement would turn it into a module and break the global augmentation.

declare namespace Cloudflare {
  interface Env {
    // State + photo bindings (D3).
    DRAFTS: KVNamespace;
    PHOTOS: R2Bucket;

    // The OAuthProvider's own token store, and the helpers object it injects
    // into the handlers at request time (never a wrangler binding — populated
    // by the library before it calls defaultHandler/apiHandler).
    OAUTH_KV: KVNamespace;
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;

    // Signed-link HMAC secret for the upload/preview pages (D9).
    LINK_SECRET: string;

    // Two OAuth password accounts (spec §295-304).
    OAUTH_MARINDA_USERNAME?: string;
    OAUTH_MARINDA_PASSWORD?: string;
    OAUTH_JOSHUA_USERNAME?: string;
    OAUTH_JOSHUA_PASSWORD?: string;

    // GitHub App credentials for the publish pipeline (D2/D6).
    GITHUB_APP_ID?: string;
    GITHUB_INSTALLATION_ID?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_OWNER?: string;
    GITHUB_REPO?: string;

    // Anthropic key + model for the async translation job (D5).
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;

    // Where terminal errors alert Joshua (in-Worker webhook, D9).
    ALERT_WEBHOOK?: string;

    // Non-secret configuration.
    SITE_BASE_URL?: string;
    // "true" keeps publishes as PRs for Joshua; anything else publishes direct.
    PILOT_MODE?: string;
    // Joshua's GitHub handle, surfaced in PR titles/bodies.
    REVIEWER?: string;
  }
}

// A type alias, not `interface Env extends Cloudflare.Env {}` — an
// interface with no members of its own trips
// @typescript-eslint/no-empty-object-type, and the alias carries the same
// members without it.
type Env = Cloudflare.Env;
