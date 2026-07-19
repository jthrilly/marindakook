import { getPostIndex, getSite, getTerms, localizeSummaries, paginate } from "@/lib/content";
import { getDict, localizeTermName } from "@/lib/i18n";
import { categoryPath, tagPath } from "@/lib/paths";
import type { Locale, Term } from "@/lib/types";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { Sidebar } from "@/components/widgets/Sidebar";

export async function ArchiveView({
  locale,
  kind,
  term,
  page,
}: {
  locale: Locale;
  kind: "category" | "tag";
  term: Term;
  page: number;
}) {
  const [site, index, terms] = await Promise.all([getSite(), getPostIndex(), getTerms()]);
  const dict = getDict(locale);
  const all = index.filter((p) => (kind === "category" ? p.categories : p.tags).includes(term.id));
  const { items, totalPages } = paginate(all, page, site.postsPerPage);
  const posts = await localizeSummaries(items, locale);
  const pathFor = (p: number) =>
    kind === "category" ? categoryPath(locale, term.slug, p) : tagPath(locale, term.slug, p);

  return (
    <div className="flex flex-col gap-12 py-12 lg:flex-row lg:gap-[2%]">
      <section className="min-w-0 flex-1">
        <h1 className="mb-8 text-[32px] font-normal">
          {kind === "category" ? localizeTermName(term, locale) : term.name}
          {page > 1 ? ` — ${dict.pageSuffix(page)}` : ""}
        </h1>
        {term.description && <p className="mb-8 -mt-4 text-meta">{term.description}</p>}
        <div className="space-y-10">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              post={post}
              categories={terms.categories}
              locale={locale}
              dict={dict}
              readMore={site.home.readMore}
              headingLevel={2}
            />
          ))}
        </div>
        <Pagination page={page} totalPages={totalPages} pathFor={pathFor} dict={dict} />
      </section>
      <Sidebar site={site} locale={locale} dict={dict} />
    </div>
  );
}
