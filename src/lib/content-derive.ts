import type { FeaturedImage, Post } from "./content-schema";

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  categories: number[];
  tags: number[];
  featured: FeaturedImage | null;
  hasRecipe: boolean;
  commentCount: number;
}

export function derivePostIndex(posts: Post[]): PostSummary[] {
  return posts
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      date: p.date,
      excerpt: p.excerpt,
      categories: p.categories,
      tags: p.tags,
      featured: p.featured,
      hasRecipe: p.recipe !== null,
      commentCount: p.comments.length,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id));
}

export function deriveTermCounts(index: PostSummary[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const post of index) {
    for (const id of [...post.categories, ...post.tags]) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
