import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { compareTranslation } from "../src/lib/translation-check.mjs";
import { buildTranslatePrompt } from "../src/lib/translate-prompt.ts";

const DEFAULT_SLUGS = [
  "lemoen-stroopkoek",
  "3-bestandele-piesangbrood-tog-te-lekker",
  "pampoenpoffertjies-wat-die-sous-opsuig",
  "spekko-dahl-kerrie-met-krispie-uie",
  "skons-net-3-bestandele",
];

export function parseModelJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export function scoreCandidate(af, candidate) {
  const issues = compareTranslation(af, candidate);
  return { pass: issues.length === 0, issues };
}

async function translate(af, apiKey, model) {
  const [template, styleGuide] = await Promise.all([
    readFile(new URL("../server/prompts/translate-en.md", import.meta.url), "utf8"),
    readFile(new URL("../content/style-guide.en.md", import.meta.url), "utf8"),
  ]);
  const prompt = buildTranslatePrompt({
    template,
    styleGuide,
    sourceJson: JSON.stringify(af),
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseModelJson(data.content.map((b) => b.text ?? "").join(""));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { values } = parseArgs({
    options: {
      slugs: { type: "string" },
      model: { type: "string", default: "claude-sonnet-5" },
    },
  });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set. The harness makes real API calls; set the key and re-run.",
    );
    process.exit(2);
  }
  const slugs = values.slugs ? values.slugs.split(",") : DEFAULT_SLUGS;
  let failed = 0;
  for (const slug of slugs) {
    const af = JSON.parse(
      await readFile(new URL(`../content/posts/${slug}.json`, import.meta.url), "utf8"),
    );
    try {
      const candidate = await translate(af, apiKey, values.model);
      const { pass, issues } = scoreCandidate(af, candidate);
      if (pass) {
        console.log(`PASS ${slug}`);
      } else {
        failed++;
        console.log(`FAIL ${slug}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
      }
    } catch (err) {
      failed++;
      console.log(`ERROR ${slug}: ${err.message}`);
    }
  }
  console.log(`\n${slugs.length} sampled, ${slugs.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
