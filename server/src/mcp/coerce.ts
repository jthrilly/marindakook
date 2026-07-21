// A real MCP client (the Claude connector) serializes structured tool arguments —
// arrays like `categories`/`tags`, objects like `recipe`/`seo`, or a `featured`
// boolean — as JSON STRINGS, because those fields are advertised as
// `z.unknown()` (D4) and so carry no type in the generated JSON schema for the
// client to serialize against. The handlers validate with the loose draft schema,
// which then rejects a stringified list/object as the wrong type — blocking a real
// client even when it sent a valid value.
//
// `coerceJsonStrings` undoes that: for each named structured field whose value is
// a string, it tries `JSON.parse` and, on success, replaces the string with the
// parsed value. A field that is already the right shape (not a string) is left
// alone, so a client that sends real arrays/objects also works. A string that is
// not valid JSON is left untouched — a genuine string the schema/handler judges
// afterwards, preserving the Afrikaans error mapping. Only the listed fields are
// touched, so genuine string fields (title, html, …) are never mangled.
export function coerceJsonStrings(
  input: Record<string, unknown>,
  structuredFields: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };
  for (const field of structuredFields) {
    const value = output[field];
    if (typeof value !== "string") {
      continue;
    }
    try {
      output[field] = JSON.parse(value);
    } catch {
      // Not JSON — a genuine string; leave it for the schema/handler to judge.
    }
  }
  return output;
}

// The draft content fields whose values are structured (array/object/boolean) and
// therefore arrive JSON-stringified from a real client. Shared by save_draft and
// update_post; genuine string fields (title, slug, excerpt, html, prose, …) are
// intentionally excluded so they are never JSON-parsed.
export const STRUCTURED_DRAFT_FIELDS = ["categories", "tags", "seo", "recipe", "featured"] as const;
