import { getPostIndex, getSite, getTerms, localizeSummaries, paginate } from "@/lib/content";
import { getDict, localizeSiteStrings, localizeWidgetTitle } from "@/lib/i18n";
import { homePath } from "@/lib/paths";
import type { Locale } from "@/lib/types";
import { FeaturedGrid } from "@/components/FeaturedGrid";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { NewsletterForm } from "@/components/widgets/NewsletterForm";
import { Sidebar } from "@/components/widgets/Sidebar";

export async function HomeView({ locale, page }: { locale: Locale; page: number }) {
  const [site, index, terms] = await Promise.all([getSite(), getPostIndex(), getTerms()]);
  const dict = getDict(locale);
  const en = localizeSiteStrings(locale);

  const featuredCat = terms.categories.find((c) => c.slug === site.home.featuredCategory);
  const featured = featuredCat
    ? await localizeSummaries(index.filter((p) => p.categories.includes(featuredCat.id)).slice(0, 3), locale)
    : [];

  const { items, totalPages } = paginate(index, page, site.postsPerPage);
  const posts = await localizeSummaries(items, locale);

  return (
    <>
      {page === 1 && (
        <>
          <div className="pt-8">
            <FeaturedGrid posts={featured} categories={terms.categories} locale={locale} />
          </div>
          <section className="-mx-4 mt-12 bg-peach-soft px-4 py-12">
            <NewsletterForm
              action={site.newsletter.action}
              heading={en ? en.newsletter.heading : site.newsletter.heading}
              instructions={dict.newsletterInstructions}
              namePlaceholder={dict.newsletterName}
              emailPlaceholder={en ? en.newsletter.placeholder : site.newsletter.placeholder}
              buttonLabel={en ? en.newsletter.button : site.newsletter.button}
              variant="band"
            />
          </section>
        </>
      )}
      <div className="flex flex-col gap-12 py-12 lg:flex-row lg:gap-[2%]">
        <section className="min-w-0 flex-1">
          <h2 className="mb-8 text-[32px] font-normal">
            {localizeWidgetTitle(site.home.sectionTitle, locale)}
            {page > 1 ? ` — ${dict.pageSuffix(page)}` : ""}
          </h2>
          <div className="space-y-10">
            {posts.map((post) => (
              <PostCard
                key={post.slug}
                post={post}
                categories={terms.categories}
                locale={locale}
                dict={dict}
                readMore={site.home.readMore}
              />
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} pathFor={(p) => homePath(locale, p)} dict={dict} />
        </section>
        <Sidebar site={site} locale={locale} dict={dict} />
      </div>
    </>
  );
}
