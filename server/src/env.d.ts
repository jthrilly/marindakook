// Ambient Env binding type for the Worker. Bindings are declared (commented)
// in wrangler.toml and provided to tests by miniflare in vitest.config.ts.
// Secrets are added as later tasks need them (spec D11 / Task 9).
interface Env {
  DRAFTS: KVNamespace;
  PHOTOS: R2Bucket;
}
