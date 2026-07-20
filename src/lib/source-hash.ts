import { createHash } from "node:crypto";

// Only field SELECTION matters to the hash; value types are enforced by the
// content schemas, not here. `unknown` fields let callers pass raw disk JSON
// (Record<string, unknown>) and parsed Post/Page objects without assertions.
export interface TranslationSource {
  title: unknown;
  excerpt?: unknown;
  html: unknown;
  recipe?: unknown;
  seo: unknown;
}

// The field picks and their order are a persisted contract: every committed
// translation stores a sourceHash over exactly this basis. Do not change.
export function sourceHashOf(source: TranslationSource): string {
  const basis = JSON.stringify({
    title: source.title,
    excerpt: source.excerpt ?? null,
    html: source.html,
    recipe: source.recipe ?? null,
    seo: source.seo,
  });
  return createHash("sha1").update(basis).digest("hex");
}
