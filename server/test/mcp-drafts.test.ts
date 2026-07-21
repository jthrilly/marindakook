import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { PostSummary } from "@site/lib/content-derive";
import { InMemoryStore } from "../src/core/store";
import { createMcpServer, type CategoryOption, type McpServerDeps } from "../src/mcp/server";

// A faithful excerpt of prompts/interview-af.md: `begin_draft`/`resume_draft`
// must return whatever protocol text is injected, verbatim. The distinctive
// sentence below is genuinely present in the committed protocol file.
const DISTINCTIVE = 'Moet hierdie resep op die voorblad wys?';
const PROTOCOL_FIXTURE = [
  '# Onderhoud-protokol — nuwe resep',
  '',
  'Praat net Afrikaans. Een vraag op een slag. Versin nooit hoeveelhede nie.',
  '',
  `Vra uitdruklik: "${DISTINCTIVE}"`,
  '',
  '[[ONDERHOUD-PROTOKOL-TOETS-MERKER]]',
].join('\n');

const STYLE_AF = '# Marinda se stem — [[STYLGIDS-AF-MERKER]]';
const STYLE_EN = "# Marinda's voice — [[STYLE-GUIDE-EN-MARKER]]";

function post(overrides: Partial<PostSummary> & Pick<PostSummary, 'id' | 'slug' | 'title'>): PostSummary {
  return {
    date: '2020-01-01T00:00:00',
    excerpt: '',
    categories: [],
    tags: [],
    featured: null,
    hasRecipe: true,
    commentCount: 0,
    ...overrides,
  };
}

const POST_INDEX: PostSummary[] = [
  post({ id: 7001, slug: 'piesangbrood', title: 'Piesangbrood', categories: [10], tags: [20] }),
  post({ id: 7002, slug: 'sjokoladekoek', title: 'Sjokoladekoek', categories: [10], tags: [21] }),
  post({ id: 7003, slug: 'lamskerrie', title: 'Lamskerrie', categories: [11], tags: [22] }),
];

const CATEGORIES: CategoryOption[] = [
  { id: 10, name: 'Nagereg', slug: 'nagereg' },
  { id: 11, name: 'Vleis', slug: 'vleis' },
  { id: 999, name: 'Featured', slug: 'featured' },
  { id: 998, name: 'Uncategorised', slug: 'uncategorised' },
  { id: 997, name: 'Eenhede', slug: 'eenhede' },
];

function makeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  let counter = 0;
  return {
    store: new InMemoryStore(),
    interviewProtocol: PROTOCOL_FIXTURE,
    styleGuides: { af: STYLE_AF, en: STYLE_EN },
    translatePrompt: "TRANSLATE PROMPT",
    postIndex: POST_INDEX,
    categories: CATEGORIES,
    now: () => new Date('2026-07-20T09:00:00.000Z'),
    createDraftId: () => `d-test-${(counter += 1)}`,
    ...overrides,
  };
}

interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

async function connect(deps: McpServerDeps): Promise<Client> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  return { content, structuredContent: toRecord(result.structuredContent), isError: result.isError === true };
}

function textOf(result: ToolResult): string {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function stringField(result: ToolResult, key: string): string {
  const value = result.structuredContent?.[key];
  if (typeof value !== 'string') {
    throw new Error(`expected structuredContent.${key} to be a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

describe('MCP draft + interview tools', () => {
  let client: Client;
  let deps: McpServerDeps;

  beforeEach(async () => {
    deps = makeDeps();
    client = await connect(deps);
  });

  it('begin_draft returns the interview protocol verbatim and reports a fresh draft id', async () => {
    const result = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });

    expect(result.isError).toBe(false);
    const text = textOf(result);
    expect(text).toContain(PROTOCOL_FIXTURE);
    expect(text).toContain(DISTINCTIVE);
    expect(result.structuredContent?.created).toBe(true);
    expect(stringField(result, 'draftId')).toMatch(/^d-test-/);
  });

  it('begin_draft surfaces a near-duplicate published post before the interview continues', async () => {
    const result = await call(client, 'begin_draft', { title: 'Piesangbrood' });

    const text = textOf(result);
    expect(text).toContain(PROTOCOL_FIXTURE);
    expect(text).toContain('Piesangbrood');
    const duplicates = result.structuredContent?.duplicatePosts;
    expect(Array.isArray(duplicates)).toBe(true);
    expect(JSON.stringify(duplicates)).toContain('piesangbrood');
  });

  it('begin_draft filters internal terms out of the offered categories', async () => {
    const result = await call(client, 'begin_draft', { title: 'Iets nuuts' });
    const offered = result.structuredContent?.categories;
    const serialised = JSON.stringify(offered);
    expect(serialised).toContain('Nagereg');
    expect(serialised).not.toContain('Featured');
    expect(serialised).not.toContain('Uncategorised');
    expect(serialised).not.toContain('Eenhede');
  });

  it('save_draft accepts a partial {title} and list_drafts then shows it', async () => {
    const begin = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });
    const draftId = stringField(begin, 'draftId');

    const saved = await call(client, 'save_draft', { draftId, title: 'Wortelkoek' });
    expect(saved.isError).toBe(false);

    const listed = await call(client, 'list_drafts');
    expect(listed.isError).toBe(false);
    expect(JSON.stringify(listed.structuredContent)).toContain('Wortelkoek');
    expect(JSON.stringify(listed.structuredContent)).toContain(draftId);
  });

  it('save_draft rejects an invalid field with an Afrikaans error naming the field', async () => {
    const begin = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });
    const draftId = stringField(begin, 'draftId');

    const result = await call(client, 'save_draft', { draftId, title: 123 });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('title');
    // Afrikaans, not the SDK's English "Invalid arguments" message.
    expect(text.toLowerCase()).toContain('veld');
    expect(text).not.toContain('Invalid arguments');
  });

  it('save_draft accepts structured fields sent as JSON strings (real MCP client) and stores them parsed', async () => {
    const begin = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });
    const draftId = stringField(begin, 'draftId');

    // A real Claude MCP client serialises structured values as JSON STRINGS
    // because the input fields are advertised as z.unknown() (no JSON-schema type).
    const saved = await call(client, 'save_draft', {
      draftId,
      title: 'Wortelkoek',
      categories: '[10]',
      tags: '[20]',
      featured: 'true',
      seo: '{"title":"Wortelkoek - Marinda Kook","description":null}',
      recipe: '{"ingredientGroups":[{"title":"Deeg","items":["2 koppies meel"]}]}',
    });
    expect(saved.isError).toBe(false);

    const stored = await deps.store.get(draftId);
    const draft = stored?.draft;
    if (draft === undefined || draft.kind !== 'post') {
      throw new Error('expected a stored post draft');
    }
    expect(draft.categories).toEqual([10]);
    expect(draft.tags).toEqual([20]);
    expect(draft.seo?.title).toBe('Wortelkoek - Marinda Kook');
    expect(draft.recipe?.ingredientGroups?.[0]?.items).toEqual(['2 koppies meel']);
    expect(draft.interview?.featured).toBe(true);
  });

  it('list_categories returns offered categories (id + Afrikaanse naam) and excludes internal terms', async () => {
    const result = await call(client, 'list_categories');
    expect(result.isError).toBe(false);
    const serialised = JSON.stringify(result.structuredContent);
    expect(serialised).toContain('Nagereg');
    expect(serialised).toContain('Vleis');
    expect(serialised).toContain('"id":10');
    expect(serialised).toContain('"id":11');
    expect(serialised).not.toContain('Featured');
    expect(serialised).not.toContain('Uncategorised');
    expect(serialised).not.toContain('Eenhede');
  });

  it('resume_draft returns the protocol text plus the settled/pending interview state', async () => {
    const begin = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });
    const draftId = stringField(begin, 'draftId');
    await call(client, 'save_draft', { draftId, title: 'Wortelkoek' });

    const result = await call(client, 'resume_draft', { draftId });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain(PROTOCOL_FIXTURE);
    expect(JSON.stringify(result.structuredContent?.settled)).toContain('title');
    expect(JSON.stringify(result.structuredContent?.pending)).not.toContain('"title"');
  });

  it('resume_draft returns an Afrikaans message for an unknown draft', async () => {
    const result = await call(client, 'resume_draft', { draftId: 'does-not-exist' });
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain('konsep');
  });

  it('discard_draft removes the draft and its staged photos', async () => {
    const begin = await call(client, 'begin_draft', { title: 'Wortelkoek met kaneel' });
    const draftId = stringField(begin, 'draftId');
    await deps.store.putPhoto(draftId, 'hero.jpg', new Uint8Array([1, 2, 3]), {
      contentType: 'image/jpeg',
      uploadedAt: '2026-07-20T09:00:00.000Z',
    });

    const result = await call(client, 'discard_draft', { draftId });
    expect(result.isError).toBe(false);

    expect(await deps.store.get(draftId)).toBeNull();
    expect(await deps.store.getPhoto(draftId, 'hero.jpg')).toBeNull();
  });

  it('get_style_guide returns the Afrikaans and English guide texts', async () => {
    const af = await call(client, 'get_style_guide', { locale: 'af' });
    expect(textOf(af)).toContain('[[STYLGIDS-AF-MERKER]]');

    const en = await call(client, 'get_style_guide', { locale: 'en' });
    expect(textOf(en)).toContain('[[STYLE-GUIDE-EN-MARKER]]');
  });

  it('get_similar_posts scores by shared category and title-keyword overlap', async () => {
    const result = await call(client, 'get_similar_posts', {
      title: 'Sjokolade Piesangbrood',
      categories: [10],
    });

    expect(result.isError).toBe(false);
    const serialised = JSON.stringify(result.structuredContent);
    expect(serialised).toContain('piesangbrood');
    // Lamskerrie shares neither category 10 nor a title keyword; it must not rank.
    expect(serialised).not.toContain('lamskerrie');
  });
});
