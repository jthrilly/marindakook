import Link from "next/link";
import { getPostIndex, getPostSummary, getTerms } from "@/lib/content";
import type { Dictionary } from "@/lib/i18n";
import { formatDate, localizeSiteStrings, localizeTermName, localizeWidgetTitle } from "@/lib/i18n";
import { asset, categoryPath, localePath, postPath } from "@/lib/paths";
import type { Locale, Site } from "@/lib/content-schema";
import type { PostSummary } from "@/lib/content-derive";
import { SocialIcons } from "@/components/chrome/SocialIcons";
import { NewsletterForm } from "./NewsletterForm";
import { PopularTabs } from "./PopularTabs";
import { CategoriesSelect } from "./CategoriesSelect";

function WidgetTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-5 text-[18px] font-medium uppercase tracking-wide text-accent">{children}</h3>
  );
}

function MiniPostList({ posts, locale, withDate }: { posts: PostSummary[]; locale: Locale; withDate?: boolean }) {
  return (
    <ul className="space-y-4">
      {posts.map((post) => (
        <li key={post.slug} className="flex items-center gap-4">
          {post.featured?.thumb && (
            <Link href={postPath(locale, post.slug)} className="shrink-0" tabIndex={-1}>
              <img
                src={asset(post.featured.thumb.src)}
                alt=""
                width={90}
                height={90}
                loading="lazy"
                className="h-[90px] w-[90px] object-cover"
              />
            </Link>
          )}
          <div className="min-w-0">
            <h4 className="text-[17px] leading-snug font-normal">
              <Link href={postPath(locale, post.slug)} className="text-ink transition-colors hover:text-accent">
                {post.title}
              </Link>
            </h4>
            {withDate && (
              <time dateTime={post.date} className="mt-1 block text-[13px] uppercase tracking-[0.1em] text-meta">
                {formatDate(post.date)}
              </time>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

async function resolveList(refs: { slug: string }[], locale: Locale, limit = 5) {
  const resolved = await Promise.all(refs.slice(0, limit).map((r) => getPostSummary(r.slug, locale)));
  return resolved.filter((p): p is PostSummary => Boolean(p));
}

export async function Sidebar({
  site,
  locale,
  dict,
}: {
  site: Site;
  locale: Locale;
  dict: Dictionary;
}) {
  const [index, terms] = await Promise.all([getPostIndex(), getTerms()]);
  const en = localizeSiteStrings(locale);
  const latest = await Promise.all(
    index.slice(0, site.sidebar.featurePosts.count).map(async (p) => (await getPostSummary(p.slug, locale)) ?? p),
  );
  const popularViews = await resolveList(site.sidebar.popularViews, locale);
  const popularComments = await resolveList(site.sidebar.popularComments, locale);
  const categories = terms.categories
    .filter((c) => c.count > 0 && c.slug !== "featured")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="no-print w-full space-y-10 lg:w-[30%]">
      <div className="bg-peach-soft px-8 py-10 text-center">
        {site.bio.photo && (
          <img
            src={asset(site.bio.photo)}
            alt={site.bio.name}
            width={150}
            height={150}
            className="mx-auto mb-5 h-[150px] w-[150px] rounded-full object-cover"
          />
        )}
        <h3 className="font-serif text-[26px]">{site.bio.name}</h3>
        <p className="mt-4 text-[15px] leading-relaxed">{en ? en.bioAbout : site.bio.about}</p>
        <Link
          href={localePath(locale, site.bio.button.path)}
          className="mt-5 inline-block bg-accent px-[17px] py-[5px] text-[15px] text-white transition-colors hover:bg-navy"
        >
          {localizeWidgetTitle(site.bio.button.label, locale)}
        </Link>
      </div>

      <div>
        <PopularTabs
          tabs={[
            {
              title: localizeWidgetTitle(site.sidebar.tabs.views, locale),
              content: <MiniPostList posts={popularViews} locale={locale} />,
            },
            {
              title: localizeWidgetTitle(site.sidebar.tabs.comments, locale),
              content: <MiniPostList posts={popularComments} locale={locale} />,
            },
          ]}
        />
      </div>

      <div>
        <WidgetTitle>{localizeWidgetTitle(site.sidebar.featurePosts.title, locale)}</WidgetTitle>
        <MiniPostList posts={latest} locale={locale} withDate />
      </div>

      <div>
        <WidgetTitle>{localizeWidgetTitle(site.sidebar.socialWidget.title, locale)}</WidgetTitle>
        <p className="mb-4 text-[15px]">{en ? en.socialDescription : site.sidebar.socialWidget.description}</p>
        <SocialIcons social={site.social} size={34} />
      </div>

      <div className="bg-peach-soft px-7 py-10">
        <NewsletterForm
          action={site.newsletter.action}
          heading={en ? en.newsletter.heading : site.newsletter.heading}
          instructions={dict.newsletterInstructions}
          namePlaceholder={dict.newsletterName}
          emailPlaceholder={en ? en.newsletter.placeholder : site.newsletter.placeholder}
          buttonLabel={en ? en.newsletter.button : site.newsletter.button}
          variant="sidebar"
        />
      </div>

      <div>
        <WidgetTitle>{localizeWidgetTitle(site.sidebar.categoriesWidget.title, locale)}</WidgetTitle>
        <CategoriesSelect
          label={localizeWidgetTitle(site.sidebar.categoriesWidget.title, locale)}
          options={categories.map((c) => ({
            value: asset(categoryPath(locale, c.slug)),
            label: `${localizeTermName(c, locale)} (${c.count})`,
          }))}
        />
      </div>
    </aside>
  );
}
