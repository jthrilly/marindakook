import { getPostIndex, getPostSummary, getSite, getTerms } from "@/lib/content";
import { formatDate, getDict } from "@/lib/i18n";
import type { Locale, Post } from "@/lib/types";
import { CatLinks, CommentsLabel } from "@/components/PostCard";
import { PostBody } from "@/components/post/PostBody";
import { AuthorBox, CommentList, PrevNext, ShareRow, TagList } from "@/components/post/PostExtras";
import { Sidebar } from "@/components/widgets/Sidebar";
import { RecipeJsonLd } from "@/components/RecipeJsonLd";

export async function PostView({ locale, post }: { locale: Locale; post: Post }) {
  const [site, terms, index] = await Promise.all([getSite(), getTerms(), getPostIndex()]);
  const dict = getDict(locale);
  const pos = index.findIndex((p) => p.slug === post.slug);
  // WordPress "previous" is the older post; the index is newest-first.
  const prevSummary = pos >= 0 && pos + 1 < index.length ? index[pos + 1] : null;
  const nextSummary = pos > 0 ? index[pos - 1] : null;
  const prev = prevSummary ? await getPostSummary(prevSummary.slug, locale) : null;
  const next = nextSummary ? await getPostSummary(nextSummary.slug, locale) : null;

  return (
    <div className="flex flex-col gap-12 py-12 lg:flex-row lg:gap-[2%]">
      <article className="min-w-0 flex-1">
        <header>
          <CatLinks ids={post.categories} categories={terms.categories} locale={locale} />
          <h1 className="mt-2 text-[34px] leading-tight font-medium sm:text-[42px]">{post.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-3 text-[13px] uppercase tracking-[0.12em] text-meta">
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>•</span>
            <CommentsLabel count={post.comments.length} dict={dict} />
          </div>
        </header>

        <div className="mt-8">
          <PostBody html={post.html} recipe={post.recipe} dict={dict} />
        </div>
        {post.recipe && <RecipeJsonLd post={post} locale={locale} />}

        <div className="no-print">
          <TagList ids={post.tags} tags={terms.tags} locale={locale} />
          <ShareRow post={post} locale={locale} dict={dict} />
          <AuthorBox site={site} locale={locale} />
          <PrevNext prev={prev} next={next} locale={locale} dict={dict} />
          <CommentList comments={post.comments} dict={dict} />
        </div>
      </article>
      <Sidebar site={site} locale={locale} dict={dict} />
    </div>
  );
}
