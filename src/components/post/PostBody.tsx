import type { Dictionary } from "@/lib/i18n";
import { withBasePath } from "@/lib/paths";
import type { Recipe } from "@/lib/content-schema";
import { RecipeCard } from "./RecipeCard";

const RECIPE_SLOT = /<div data-recipe-slot="1"><\/div>/;

export function PostBody({ html, recipe, dict }: { html: string; recipe: Recipe | null; dict: Dictionary }) {
  if (recipe && RECIPE_SLOT.test(html)) {
    const [before, after] = html.split(RECIPE_SLOT);
    return (
      <div className="entry-content">
        {before?.trim() && <div dangerouslySetInnerHTML={{ __html: withBasePath(before) }} />}
        <RecipeCard recipe={recipe} dict={dict} />
        {after?.trim() && <div dangerouslySetInnerHTML={{ __html: withBasePath(after) }} />}
      </div>
    );
  }
  return (
    <div className="entry-content">
      {recipe && <RecipeCard recipe={recipe} dict={dict} />}
      <div dangerouslySetInnerHTML={{ __html: withBasePath(html) }} />
    </div>
  );
}
