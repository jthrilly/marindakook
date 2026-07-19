import { absoluteUrl, asset, postPath } from "@/lib/paths";
import type { Locale, Post } from "@/lib/types";

function parseDuration(pairs: { value: string; unit: string }[]): string | null {
  let minutes = 0;
  for (const { value, unit } of pairs) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) continue;
    if (/^hour/i.test(unit)) minutes += n * 60;
    else if (/^day/i.test(unit)) minutes += n * 60 * 24;
    else minutes += n;
  }
  return minutes > 0 ? `PT${minutes}M` : null;
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function RecipeJsonLd({ post, locale }: { post: Post; locale: Locale }) {
  const recipe = post.recipe;
  if (!recipe) return null;
  const find = (label: RegExp) => recipe.details.find((d) => label.test(d.label));
  const prep = find(/prep/i);
  const cook = find(/cook/i);
  const servings = find(/serving/i);
  const calories = find(/calorie/i);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    author: { "@type": "Person", name: recipe.author ?? "Marinda Engelbrecht" },
    datePublished: post.date,
    description: post.seo.description ?? post.excerpt,
    inLanguage: locale === "af" ? "af-ZA" : "en-ZA",
    url: absoluteUrl(asset(postPath(locale, post.slug))),
    recipeIngredient: recipe.ingredientGroups.flatMap((g) => g.items.map(textOf)),
    recipeInstructions: recipe.directionGroups.flatMap((g) =>
      g.steps.map((s) => ({ "@type": "HowToStep", text: textOf(s) })),
    ),
  };
  if (recipe.image) data.image = [absoluteUrl(asset(recipe.image.src))];
  const prepDuration = prep && parseDuration(prep.pairs);
  if (prepDuration) data.prepTime = prepDuration;
  const cookDuration = cook && parseDuration(cook.pairs);
  if (cookDuration) data.cookTime = cookDuration;
  if (servings?.pairs[0]?.value) data.recipeYield = servings.pairs.map((p) => `${p.value} ${p.unit}`.trim()).join(" ");
  if (calories?.pairs[0]?.value) {
    data.nutrition = { "@type": "NutritionInformation", calories: `${calories.pairs[0].value} ${calories.pairs[0].unit}` };
  }
  if (recipe.courses.length) data.recipeCategory = recipe.courses.join(", ");
  if (recipe.cuisines.length) data.recipeCuisine = recipe.cuisines.join(", ");

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
