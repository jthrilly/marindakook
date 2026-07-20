import type { z } from "zod";

// Turns the first zod issue into an actionable Afrikaans sentence that names the
// offending field — the model reads this back and knows exactly what to fix.
// Shared by the draft tools (save_draft) and the publish/chrome completeness
// checks (postSchema/siteSchema.parse) so "which field is wrong" reads the same
// everywhere.

function afrikaansType(expected: unknown): string {
  switch (expected) {
    case "string":
      return "'n string (teks)";
    case "number":
      return "'n getal";
    case "boolean":
      return "waar of onwaar";
    case "array":
      return "'n lys";
    case "object":
      return "'n voorwerp";
    default:
      return `van die regte tipe (${String(expected)})`;
  }
}

function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  return path.length === 0 ? "die konsep" : path.map(String).join(".");
}

export function describeZodIssue(issue: z.core.$ZodIssue): string {
  const field = fieldLabel(issue.path);
  if (issue.code === "invalid_type") {
    return `Die veld «${field}» is nie geldig nie — dit moet ${afrikaansType(issue.expected)} wees.`;
  }
  if (issue.code === "unrecognized_keys") {
    return `Die veld «${field}» bevat onbekende sleutel(s): ${issue.keys.join(", ")}. Kyk die naam na.`;
  }
  return `Die veld «${field}» is nie geldig nie: ${issue.message}`;
}
