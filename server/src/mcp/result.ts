import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Every tool answers in Afrikaans. `ok`/`fail` keep that uniform: a text block
// the chat model reads aloud, plus optional machine-readable `structuredContent`
// (draft ids, settled/pending state, surfaced duplicates) that a client can act
// on without re-parsing the prose.
export function ok(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  if (structuredContent) {
    return { content: [{ type: "text", text }], structuredContent };
  }
  return { content: [{ type: "text", text }] };
}

export function fail(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  if (structuredContent) {
    return { content: [{ type: "text", text }], structuredContent, isError: true };
  }
  return { content: [{ type: "text", text }], isError: true };
}
