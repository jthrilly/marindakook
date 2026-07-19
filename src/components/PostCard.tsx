import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n";
import { asset, categoryPath, postPath } from "@/lib/paths";
import type { Locale, PostSummary, Term } from "@/lib/types";

export function CatLinks({
  ids,
  categories,
  locale,
}: {
  ids: number[];
  categories: Term[];
  locale: Locale;
}) {
  const cats = ids
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Term => Boolean(c));
  if (!cats.length) return null;
  return (
    <span className="text-[15px] leading-snug">
      {cats.map((cat, i) => (
        <span key={cat.id}>
          {i > 0 && ", "}
          <Link href={categoryPath(locale, cat.slug)} className="text-accent hover:border-b hover:border-ink hover:text-ink">
            {cat.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

export function CommentsLabel({ count, dict }: { count: number; dict: Dictionary }) {
  const label =
    count === 0 ? dict.commentsDisabled : count === 1 ? dict.oneComment : dict.commentsTitle(count);
  return <span>{label}</span>;
}

export function PostCard({
  post,
  categories,
  locale,
  dict,
  readMore,
  headingLevel = 3,
}: {
  post: PostSummary;
  categories: Term[];
  locale: Locale;
  dict: Dictionary;
  readMore: string;
  headingLevel?: 2 | 3;
}) {
  const href = postPath(locale, post.slug);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex flex-col gap-6 border-b border-peach-soft pb-10 last:border-b-0 last:pb-0 sm:flex-row sm:gap-0">
      {post.featured?.card && (
        <div className="shrink-0 sm:w-[380px]">
          <Link href={href} title={post.title}>
            <img
              src={asset(post.featured.card.src)}
              alt={post.featured.alt}
              width={380}
              height={380}
              loading="lazy"
              className="h-auto w-full object-cover sm:h-[380px] sm:w-[380px]"
            />
          </Link>
        </div>
      )}
      <section className="min-w-0 sm:pl-8">
        <div className="mb-2">
          <CatLinks ids={post.categories} categories={categories} locale={locale} />
        </div>
        <Heading className="text-[28px] leading-tight font-normal">
          <Link href={href} rel="bookmark" className="text-ink transition-colors hover:text-accent">
            {post.title}
          </Link>
        </Heading>
        <div className="mt-3 flex flex-wrap gap-x-3 text-[13px] tracking-[0.12em] uppercase text-meta">
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span aria-hidden>•</span>
          <CommentsLabel count={post.commentCount} dict={dict} />
        </div>
        <div className="mt-6">
          <Link
            href={href}
            rel="bookmark"
            title={post.title}
            className="inline-block bg-accent px-[17px] py-[5px] text-[15px] text-white transition-colors duration-200 hover:bg-navy"
          >
            {readMore}
          </Link>
        </div>
      </section>
    </article>
  );
}
