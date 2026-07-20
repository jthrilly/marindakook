import { getSite } from "@/lib/content";
import { getDict } from "@/lib/i18n";
import type { Locale, Page } from "@/lib/content-schema";
import { PostBody } from "@/components/post/PostBody";
import { Sidebar } from "@/components/widgets/Sidebar";

export async function PageView({ locale, page }: { locale: Locale; page: Page }) {
  const site = await getSite();
  const dict = getDict(locale);
  return (
    <div className="flex flex-col gap-12 py-12 lg:flex-row lg:gap-[2%]">
      <article className="min-w-0 flex-1">
        <h1 className="text-[34px] leading-tight font-medium sm:text-[42px]">{page.title}</h1>
        <div className="mt-8">
          <PostBody html={page.html} recipe={null} dict={dict} />
        </div>
      </article>
      <Sidebar site={site} locale={locale} dict={dict} />
    </div>
  );
}
