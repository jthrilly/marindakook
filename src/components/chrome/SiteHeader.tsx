import Link from "next/link";
import type { Locale, Site } from "@/lib/content-schema";
import type { Dictionary } from "@/lib/i18n";
import { localizeNav } from "@/lib/i18n";
import { getSiteStrings } from "@/lib/content";
import { asset, localePath } from "@/lib/paths";
import { SocialIcons } from "./SocialIcons";
import { SearchForm } from "./SearchForm";
import { MobileNav } from "./MobileNav";

function stripLocale(path: string): string {
  return path.startsWith("/en/") ? path.slice(3) : path === "/en" ? "/" : path;
}

export async function SiteHeader({
  site,
  locale,
  dict,
  currentPath,
}: {
  site: Site;
  locale: Locale;
  dict: Dictionary;
  currentPath: string;
}) {
  const strings = await getSiteStrings(locale);
  const top = localizeNav(site.nav.top, strings).map((i) => ({ ...i, path: localePath(locale, i.path) }));
  const main = localizeNav(site.nav.main, strings).map((i) => ({ ...i, path: localePath(locale, i.path) }));
  const basePathOfCurrent = stripLocale(currentPath);
  const otherLocalePath = locale === "af" ? `/en${basePathOfCurrent}` : basePathOfCurrent;

  return (
    <header>
      <div className="bg-peach">
        <div className="mx-auto flex max-w-[1230px] items-center justify-end gap-7 px-4 py-2 text-[15px]">
          {top.map((item) => (
            <Link key={item.path} href={item.path} className="text-accent transition-colors hover:opacity-80">
              {item.label}
            </Link>
          ))}
          <a
            href={asset(otherLocalePath)}
            lang={locale === "af" ? "en" : "af"}
            hrefLang={locale === "af" ? "en" : "af"}
            className="border-l border-accent/30 pl-5 text-accent/90 transition-colors hover:opacity-80"
          >
            {dict.switchLabel}
          </a>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1230px] items-center justify-between gap-6 px-4 py-8 max-sm:flex-col md:py-12">
        <Link href={localePath(locale, "/")} className="block min-w-0 shrink transition-opacity hover:opacity-80">
          {site.logo ? (
            <img
              src={asset(site.logo.src)}
              alt={site.name}
              width={site.logo.width ? Math.round(site.logo.width / 2) : undefined}
              height={site.logo.height ? Math.round(site.logo.height / 2) : undefined}
              className="h-auto w-[540px] max-w-full"
            />
          ) : (
            <span className="font-script text-5xl text-accent">{site.name}</span>
          )}
        </Link>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-5 max-sm:justify-center">
          <SocialIcons social={site.social} />
          <SearchForm locale={locale} dict={dict} className="hidden w-[300px] min-[900px]:flex" />
        </div>
      </div>

      <div className="border-y border-peach-soft">
        <nav className="mx-auto hidden max-w-[1230px] justify-center px-4 md:flex" aria-label="Main">
          <ul className="flex flex-wrap items-center gap-x-10">
            {main.map((item) => (
              <li key={item.path}>
                <Link
                  href={item.path}
                  className={`block py-4 text-[15px] uppercase tracking-[0.08em] text-accent transition-opacity hover:opacity-75 ${
                    currentPath === item.path ? "font-bold" : "font-normal"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <MobileNav main={main} top={top} currentPath={currentPath} />
      </div>
    </header>
  );
}
