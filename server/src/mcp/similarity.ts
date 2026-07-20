import type { PostSummary } from "@site/lib/content-derive";

// Pure scoring shared by two callers: `get_similar_posts` (few-shot voice
// material) and `begin_draft`'s near-duplicate guard. Keeping it in one place
// means "similar" means the same thing whether we are ranking examples or
// warning about an accidental re-post.

const STOPWORDS = new Set([
  "die",
  "en",
  "met",
  "van",
  "vir",
  "op",
  "in",
  "se",
  "is",
  "te",
  "aan",
  "by",
  "of",
  "om",
  "uit",
  "na",
  "sonder",
]);

export function titleKeywords(title: string): Set<string> {
  const words = title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return new Set(words);
}

function countShared<T>(a: Set<T>, b: Set<T>): number {
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) {
      shared += 1;
    }
  }
  return shared;
}

export interface SimilarityQuery {
  title?: string;
  categories?: number[];
  tags?: number[];
}

export interface ScoredPost {
  post: PostSummary;
  score: number;
  sharedTerms: number;
  sharedKeywords: number;
}

export function rankSimilarPosts(
  index: PostSummary[],
  query: SimilarityQuery,
  limit: number,
): ScoredPost[] {
  const queryKeywords = query.title ? titleKeywords(query.title) : new Set<string>();
  const queryTerms = new Set<number>([...(query.categories ?? []), ...(query.tags ?? [])]);

  const scored: ScoredPost[] = index.map((post) => {
    const sharedKeywords = countShared(queryKeywords, titleKeywords(post.title));
    const sharedTerms = countShared(queryTerms, new Set<number>([...post.categories, ...post.tags]));
    return { post, score: sharedTerms * 2 + sharedKeywords, sharedTerms, sharedKeywords };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.post.date < b.post.date ? 1 : -1))
    .slice(0, limit);
}

// A near-duplicate shares most of the shorter title's keywords — enough to be
// the same recipe under a slightly different name, not merely the same theme.
export function isNearDuplicateTitle(a: string, b: string): boolean {
  const ka = titleKeywords(a);
  const kb = titleKeywords(b);
  if (ka.size === 0 || kb.size === 0) {
    return false;
  }
  const shared = countShared(ka, kb);
  return shared >= 1 && shared / Math.min(ka.size, kb.size) >= 0.5;
}

export function findNearDuplicatePosts(index: PostSummary[], title: string, limit: number): PostSummary[] {
  return index.filter((post) => isNearDuplicateTitle(title, post.title)).slice(0, limit);
}
