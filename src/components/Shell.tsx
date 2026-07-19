import type { Dictionary } from "@/lib/i18n";
import type { Locale, Site } from "@/lib/types";
import { SiteHeader } from "./chrome/SiteHeader";
import { SiteFooter } from "./chrome/SiteFooter";

export function Shell({
  site,
  locale,
  dict,
  currentPath,
  children,
}: {
  site: Site;
  locale: Locale;
  dict: Dictionary;
  currentPath: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="no-print">
        <SiteHeader site={site} locale={locale} dict={dict} currentPath={currentPath} />
      </div>
      <main id="main" className="mx-auto max-w-[1230px] px-4">
        {children}
      </main>
      <SiteFooter site={site} />
    </div>
  );
}
