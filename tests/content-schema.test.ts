import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema } from "@/lib/content-schema";

const CONTENT = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(CONTENT, ...parts), "utf8"));
}

async function listJson(dir: string): Promise<string[]> {
  return (await readdir(join(CONTENT, dir))).filter((f) => f.endsWith(".json"));
}

describe("post contract", () => {
  it("parses all committed posts", async () => {
    const files = await listJson("posts");
    expect(files.length).toBe(397);
    for (const file of files) {
      const raw = await readJson("posts", file);
      const result = postSchema.safeParse(raw);
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });
});
