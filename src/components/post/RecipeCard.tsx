import type { Dictionary } from "@/lib/i18n";
import { asset, withBasePath } from "@/lib/paths";
import type { Recipe } from "@/lib/content-schema";
import { PrintButton } from "./PrintButton";

const DETAIL_ICONS: Record<string, React.ReactNode> = {
  food: (
    <path d="M11 2a1 1 0 0 1 2 0v7a3 3 0 0 1-2 2.83V21a1 1 0 0 1-2 0v-9.17A3 3 0 0 1 7 9V2a1 1 0 0 1 2 0v7a1 1 0 0 0 2 0Zm6 0c1.66 0 3 2.24 3 5 0 2.42-1.03 4.44-2.4 4.9V21a1 1 0 0 1-2 0V11.9C14.23 11.44 13.2 9.42 13.2 7c0-2.76 1.34-5 3-5Z" />
  ),
  clock: (
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5.2 3.1 1-1.6-4.2-2.5Z" />
  ),
  "cooking-food-in-a-hot-casserole": (
    <path d="M4 10h16a1 1 0 0 1 1 1c0 4.5-2.9 8.3-7 9.6V21a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-.4C5.9 19.3 3 15.5 3 11a1 1 0 0 1 1-1Zm3.4-6.8a1 1 0 0 1 1.4.2c.9 1.2.9 2.4.1 3.7-.4.7-.4 1 .1 1.7a1 1 0 1 1-1.6 1.2c-.9-1.2-.9-2.4-.1-3.7.4-.7.4-1-.1-1.7a1 1 0 0 1 .2-1.4Zm5 0a1 1 0 0 1 1.4.2c.9 1.2.9 2.4.1 3.7-.4.7-.4 1 .1 1.7a1 1 0 1 1-1.6 1.2c-.9-1.2-.9-2.4-.1-3.7.4-.7.4-1-.1-1.7a1 1 0 0 1 .2-1.4Z" />
  ),
  "fire-flames": (
    <path d="M12 22c-4 0-7-3-7-7 0-3 2-5.5 3.5-7.5C10 5.5 11 4 11 2c3 2 5 5 5 8 .8-.8 1.4-1.8 1.7-3C19.5 8.7 19 12 19 15c0 4-3 7-7 7Zm0-2c1.7 0 3-1.3 3-3 0-1.6-1-2.9-3-4.5C10 14.1 9 15.4 9 17c0 1.7 1.3 3 3 3Z" />
  ),
  "chef-cooking": (
    <path d="M12 2a5 5 0 0 1 4.9 4A3.5 3.5 0 0 1 17 13v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-6a3.5 3.5 0 0 1 .1-7A5 5 0 0 1 12 2Zm-3 15v2h6v-2Z" />
  ),
};

function DetailIcon({ icon }: { icon: Recipe["details"][number]["icon"] }) {
  const shape = icon ? DETAIL_ICONS[icon.name] ?? DETAIL_ICONS.clock : DETAIL_ICONS.clock;
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden className="text-meta">
      {shape}
    </svg>
  );
}

function InnerHtml({ html, className, as: Tag = "span" }: { html: string; className?: string; as?: "span" | "div" | "li" | "p" }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: withBasePath(html) }} />;
}

export function RecipeCard({ recipe, dict }: { recipe: Recipe; dict: Dictionary }) {
  return (
    <div className="recipe-card-print my-8 border border-peach-mid bg-white" id="recipe-card">
      {recipe.image && (
        <figure className="relative">
          <img
            src={asset(recipe.image.src)}
            alt={recipe.image.alt}
            width={recipe.image.width ?? undefined}
            height={recipe.image.height ?? undefined}
            className="h-auto w-full"
          />
          <figcaption className="absolute right-4 bottom-4">
            <PrintButton label={dict.print} />
          </figcaption>
        </figure>
      )}

      <div className="p-6 sm:p-8">
        <header>
          <h2 className="text-[30px] leading-tight font-medium">{recipe.title}</h2>
          {recipe.author && (
            <span className="mt-1 block text-[15px] text-meta">
              {dict.recipeBy} {recipe.author}
            </span>
          )}
          {(recipe.courses.length > 0 || recipe.cuisines.length > 0 || recipe.difficulties.length > 0) && (
            <p className="mt-2 text-[14px] text-meta">
              {(
                [
                  ["Course", recipe.courses],
                  ["Cuisine", recipe.cuisines],
                  ["Difficulty", recipe.difficulties],
                ] as const
              )
                .filter(([, values]) => values.length > 0)
                .map(([label, values], i) => (
                  <span key={label}>
                    {i > 0 && "  "}
                    {label}: <mark className="bg-transparent font-medium text-body">{values.join(", ")}</mark>
                  </span>
                ))}
            </p>
          )}
        </header>

        {recipe.details.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5 border-y border-peach-soft py-5">
            {recipe.details.map((d, i) => (
              <div key={i} className="flex items-center gap-3">
                <DetailIcon icon={d.icon} />
                <div>
                  <span className="block text-[13px] uppercase tracking-wide text-meta">{d.label}</span>
                  <span className="text-[17px] text-ink">
                    {d.pairs.map((p, j) => (
                      <span key={j}>
                        {j > 0 && " "}
                        <strong className="font-medium">{p.value}</strong>
                        {p.unit && ` ${p.unit}`}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {recipe.summaryHtml && <InnerHtml as="div" html={recipe.summaryHtml} className="mt-6 italic" />}

        {recipe.ingredientGroups.length > 0 && (
          <section className="mt-8">
            <h3 className="text-[24px] font-medium">{recipe.ingredientsTitle}</h3>
            {recipe.ingredientGroups.map((group, gi) => (
              <div key={gi}>
                {group.title && <h4 className="mt-5 text-[18px] font-medium">{group.title}</h4>}
                <ul className="mt-4 space-y-3">
                  {group.items.map((item, ii) => (
                    <li key={ii} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-[5px] block h-[14px] w-[14px] shrink-0 rounded-full border-2 border-accent"
                      />
                      <InnerHtml html={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {recipe.directionGroups.length > 0 && (
          <section className="mt-8">
            <h3 className="text-[24px] font-medium">{recipe.directionsTitle}</h3>
            {recipe.directionGroups.map((group, gi) => {
              let step = 0;
              return (
                <div key={gi}>
                  {group.title && <h4 className="mt-5 text-[18px] font-medium">{group.title}</h4>}
                  <ol className="mt-4 space-y-4">
                    {group.steps.map((html, si) => {
                      step += 1;
                      return (
                        <li key={si} className="flex min-h-[44px] items-start gap-5">
                          <span aria-hidden className="w-[26px] shrink-0 text-[24px] leading-[1.4] font-bold text-ink">
                            {step}
                          </span>
                          <InnerHtml as="div" html={html} className="min-w-0 pt-[6px] [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full" />
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </section>
        )}

        {recipe.notes.length > 0 && (
          <section className="mt-8 bg-peach-soft p-6">
            <h3 className="text-[20px] font-medium">{recipe.notesTitle}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {recipe.notes.map((html, i) => (
                <InnerHtml key={i} as="li" html={html} />
              ))}
            </ul>
          </section>
        )}

        {recipe.videoHtml && (
          <InnerHtml
            as="div"
            html={recipe.videoHtml}
            className="mt-8 [&_iframe]:aspect-video [&_iframe]:h-auto [&_iframe]:w-full"
          />
        )}
      </div>
    </div>
  );
}
