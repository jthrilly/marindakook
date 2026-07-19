"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

interface SearchEntry {
  slug: string;
  title: string;
  excerpt: string;
  cats: string[];
  tags: string[];
  thumb: string | null;
  date: string;
}

interface Strings {
  title: string;
  resultsFor: string;
  noResults: string;
  prompt: string;
  placeholder: string;
}

function score(entry: SearchEntry, terms: string[]): number {
  const title = entry.title.toLowerCase();
  const excerpt = entry.excerpt.toLowerCase();
  const taxonomy = [...entry.cats, ...entry.tags].join(" ").toLowerCase();
  let total = 0;
  for (const term of terms) {
    let s = 0;
    if (title.includes(term)) s += 10;
    if (taxonomy.includes(term)) s += 5;
    if (excerpt.includes(term)) s += 2;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

function Results({ locale, readMore, strings }: { locale: string; readMore: string; strings: Strings }) {
  const params = useSearchParams();
  const query = (params.get("s") ?? "").trim();
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  useEffect(() => {
    fetch(`${base}/search-index.${locale}.json`)
      .then((r) => r.json())
      .then(setIndex)
      .catch(() => setIndex([]));
  }, [base, locale]);

  const results = useMemo(() => {
    if (!index || !query) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return index
      .map((entry) => ({ entry, s: score(entry, terms) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || (a.entry.date < b.entry.date ? 1 : -1))
      .map((r) => r.entry);
  }, [index, query]);

  const prefix = locale === "af" ? "" : "/en";

  return (
    <>
      <h1 className="mb-6 text-[32px] font-normal">
        {query ? `${strings.resultsFor} “${query}”` : strings.title}
      </h1>
      <form method="get" className="mb-10 flex max-w-xl">
        <input
          type="search"
          name="s"
          defaultValue={query}
          placeholder={strings.placeholder}
          className="w-full rounded-l-[4px] border border-peach-mid bg-peach px-4 py-2.5 text-[15px] text-accent outline-none placeholder:text-accent/90 focus:border-accent"
        />
        <button type="submit" className="cursor-pointer rounded-r-[4px] bg-accent px-5 text-white transition-colors hover:bg-navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      {!query && <p>{strings.prompt}</p>}
      {query && index === null && <p>…</p>}
      {query && index !== null && results.length === 0 && <p>{strings.noResults}</p>}

      <div className="space-y-10">
        {results.map((entry) => (
          <article key={entry.slug} className="flex gap-6 border-b border-peach-soft pb-8 last:border-b-0">
            {entry.thumb && (
              <a href={`${base}${prefix}/${entry.slug}/`} className="hidden shrink-0 sm:block" tabIndex={-1}>
                <img src={`${base}${entry.thumb}`} alt="" width={150} height={150} loading="lazy" className="h-[120px] w-[120px] object-cover" />
              </a>
            )}
            <div className="min-w-0">
              {entry.cats.length > 0 && <span className="text-[14px] text-accent">{entry.cats.join(", ")}</span>}
              <h2 className="text-[24px] leading-snug font-normal">
                <a href={`${base}${prefix}/${entry.slug}/`} className="text-ink transition-colors hover:text-accent">
                  {entry.title}
                </a>
              </h2>
              <p className="mt-2 line-clamp-3 text-[15px]">{entry.excerpt}</p>
              <a href={`${base}${prefix}/${entry.slug}/`} className="mt-3 inline-block bg-accent px-[17px] py-[5px] text-[15px] text-white transition-colors hover:bg-navy">
                {readMore}
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function SearchResults(props: { locale: string; readMore: string; strings: Strings }) {
  return (
    <Suspense fallback={null}>
      <Results {...props} />
    </Suspense>
  );
}
