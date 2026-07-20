import { getSite } from "@/lib/content";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/content-schema";
import { Sidebar } from "@/components/widgets/Sidebar";
import { SearchResults } from "@/components/SearchResults";

export async function SearchView({ locale }: { locale: Locale }) {
  const site = await getSite();
  const dict = getDict(locale);
  return (
    <div className="flex flex-col gap-12 py-12 lg:flex-row lg:gap-[2%]">
      <section className="min-w-0 flex-1">
        <SearchResults
          locale={locale}
          readMore={site.home.readMore}
          strings={{
            title: dict.searchTitle,
            resultsFor: dict.searchResultsFor,
            noResults: dict.searchNoResults,
            prompt: dict.searchPrompt,
            placeholder: dict.searchPlaceholder,
          }}
        />
      </section>
      <Sidebar site={site} locale={locale} dict={dict} />
    </div>
  );
}
