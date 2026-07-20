import Link from "next/link";
import { asset, postPath } from "@/lib/paths";
import type { Locale, Term } from "@/lib/content-schema";
import type { PostSummary } from "@/lib/content-derive";
import { CatLinks } from "./PostCard";

export function FeaturedGrid({
  posts,
  categories,
  locale,
}: {
  posts: PostSummary[];
  categories: Term[];
  locale: Locale;
}) {
  if (!posts.length) return null;
  return (
    <section className="grid grid-cols-1 gap-8 sm:grid-cols-3">
      {posts.map((post) => (
        <article key={post.id}>
          {post.featured?.portrait && (
            <Link href={postPath(locale, post.slug)} title={post.title} className="block overflow-hidden">
              <img
                src={asset(post.featured.portrait.src)}
                alt={post.featured.alt || post.title}
                width={380}
                height={520}
                className="aspect-[380/520] h-auto w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
              />
            </Link>
          )}
          <section className="mt-4">
            <CatLinks
              ids={post.categories.filter((id) => {
                const c = categories.find((t) => t.id === id);
                return c?.slug !== "featured";
              })}
              categories={categories}
              locale={locale}
            />
            <h3 className="mt-1 text-[24px] leading-snug font-normal">
              <Link href={postPath(locale, post.slug)} rel="bookmark" className="text-ink transition-colors hover:text-accent">
                {post.title}
              </Link>
            </h3>
          </section>
        </article>
      ))}
    </section>
  );
}
