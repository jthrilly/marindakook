// `src/lib/translation-check.mjs` is plain ES-module JavaScript (shared with the
// root build, the CI safety net and the regression harness), so the Worker's
// strict TS program has no declaration to resolve for it. This ambient shim
// gives the single imported symbol a type without forking the module or
// enabling `allowJs`. `source-hash.ts` and `translate-prompt.ts` are `.ts` and
// need no shim.
declare module "@site/lib/translation-check.mjs" {
  export function compareTranslation(af: unknown, en: unknown): string[];
}
