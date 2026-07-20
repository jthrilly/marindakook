// Ambient Env binding type for the Worker. Bindings are declared (commented)
// in wrangler.toml and provided to tests by miniflare in vitest.config.ts.
// Secrets are added as later tasks need them (spec D11 / Task 9).
//
// `Cloudflare.Env` is the workers-types hook other ambient declarations key
// off (e.g. `cloudflare:workers`'s `env` export, used by store tests). It
// starts as an empty interface upstream; merging our bindings into it here
// — the same shape `wrangler types` would generate — means both the global
// `Env` used by the fetch handler and the test-time `env` import see the
// same binding types, with no `as` casts on either side.
declare namespace Cloudflare {
  interface Env {
    DRAFTS: KVNamespace;
    PHOTOS: R2Bucket;
  }
}

// A type alias, not `interface Env extends Cloudflare.Env {}` — an
// interface with no members of its own trips
// @typescript-eslint/no-empty-object-type, and the alias carries the same
// members without it.
type Env = Cloudflare.Env;
