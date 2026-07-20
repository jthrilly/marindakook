import { asset, localePath } from "@/lib/paths";
import type { Locale } from "@/lib/content-schema";
import type { Dictionary } from "@/lib/i18n";

export function SearchForm({ locale, dict, className = "" }: { locale: Locale; dict: Dictionary; className?: string }) {
  return (
    <form
      action={asset(localePath(locale, "/search/"))}
      method="get"
      role="search"
      className={`flex items-center rounded-[4px] bg-peach transition-colors focus-within:ring-1 focus-within:ring-accent ${className}`}
    >
      <input
        type="search"
        name="s"
        placeholder={dict.searchPlaceholder}
        className="w-full min-w-0 bg-transparent px-4 py-2.5 text-[15px] text-accent outline-none placeholder:text-accent/90"
      />
      <button
        type="submit"
        aria-label={dict.searchTitle}
        className="flex h-10 w-11 shrink-0 items-center justify-center text-accent transition-colors hover:text-navy"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18" aria-hidden>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  );
}
