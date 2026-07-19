import { rewriteHtml } from "./rewrite.mjs";

const KNOWN_SECTIONS = [
  "recipe-card-image",
  "recipe-card-heading",
  "recipe-card-details",
  "recipe-card-summary",
  "recipe-card-ingredients",
  "recipe-card-directions",
  "recipe-card-notes",
  "recipe-card-video",
];

function text(el) {
  return el?.textContent.replace(/\s+/g, " ").trim() ?? "";
}

function iconFromClasses(classAttr) {
  const m = classAttr?.match(/\b(oldicon|foodicons|fas|far|fab)-([\w-]+)/);
  return m ? { set: m[1], name: m[2] } : null;
}

export function parseRecipeCard(root, warnings) {
  const card = root.querySelector(".wp-block-wpzoom-recipe-card-block-recipe-card");
  if (!card) return null;

  rewriteHtml(card);
  const recipe = {
    style: (card.getAttribute("class").match(/is-style-([\w-]+)/) ?? [])[1] ?? "default",
    title: "",
    author: null,
    image: null,
    courses: [],
    cuisines: [],
    difficulties: [],
    summaryHtml: null,
    details: [],
    ingredientsTitle: null,
    ingredientGroups: [],
    directionsTitle: null,
    directionGroups: [],
    notesTitle: null,
    notes: [],
    videoHtml: null,
  };

  for (const child of card.querySelectorAll(":scope > div")) {
    const cls = child.getAttribute("class") ?? "";
    const section = KNOWN_SECTIONS.find((s) => cls.split(/\s+/).includes(s));
    if (!section) {
      warnings?.push(`unknown recipe card section: ${cls}`);
    }
  }

  const img = card.querySelector(".recipe-card-image img");
  if (img) {
    recipe.image = {
      src: img.getAttribute("src"),
      srcset: img.getAttribute("srcset") ?? null,
      width: Number(img.getAttribute("width")) || null,
      height: Number(img.getAttribute("height")) || null,
      alt: img.getAttribute("alt") ?? "",
    };
  }

  recipe.title = text(card.querySelector(".recipe-card-title"));
  const author = text(card.querySelector(".recipe-card-author"));
  if (author) recipe.author = author.replace(/^Recipe by\s+/i, "");

  for (const [key, cls] of [
    ["courses", "recipe-card-course"],
    ["cuisines", "recipe-card-cuisine"],
    ["difficulties", "recipe-card-difficulty"],
  ]) {
    for (const el of card.querySelectorAll(`.${cls} mark`)) {
      recipe[key].push(text(el));
    }
  }

  for (const item of card.querySelectorAll(".recipe-card-details .detail-item")) {
    const label = text(item.querySelector(".detail-item-label"));
    const pairs = [];
    for (const el of item.querySelectorAll(".detail-item-value, .detail-item-unit")) {
      const cls = el.getAttribute("class") ?? "";
      if (cls.includes("detail-item-value")) {
        pairs.push({ value: text(el), unit: "" });
      } else if (pairs.length) {
        pairs[pairs.length - 1].unit = text(el);
      }
    }
    if (!label && !pairs.length) continue;
    recipe.details.push({
      icon: iconFromClasses(item.querySelector(".detail-item-icon")?.getAttribute("class")),
      label,
      pairs,
    });
  }

  const summary = card.querySelector(".recipe-card-summary");
  if (summary) recipe.summaryHtml = summary.innerHTML.trim();

  const ingredients = card.querySelector(".recipe-card-ingredients");
  if (ingredients) {
    recipe.ingredientsTitle = text(ingredients.querySelector(".ingredients-title"));
    let group = { title: null, items: [] };
    recipe.ingredientGroups.push(group);
    for (const li of ingredients.querySelectorAll("li")) {
      const cls = li.getAttribute("class") ?? "";
      const groupHeading = li.querySelector("strong[class*='group-title']");
      if (cls.includes("group-title") || groupHeading || (!li.querySelector(".wpzoom-rcb-ingredient-name") && text(li))) {
        group = { title: text(groupHeading ?? li), items: [] };
        recipe.ingredientGroups.push(group);
        continue;
      }
      const name = li.querySelector(".wpzoom-rcb-ingredient-name");
      if (name) group.items.push(name.innerHTML.trim());
    }
    recipe.ingredientGroups = recipe.ingredientGroups.filter((g) => g.items.length || g.title);
  }

  const directions = card.querySelector(".recipe-card-directions");
  if (directions) {
    recipe.directionsTitle = text(directions.querySelector(".directions-title"));
    let group = { title: null, steps: [] };
    recipe.directionGroups.push(group);
    for (const li of directions.querySelectorAll(".directions-list > li")) {
      const cls = li.getAttribute("class") ?? "";
      const groupHeading = li.querySelector("strong[class*='group-title']");
      if (cls.includes("group-title") || groupHeading) {
        group = { title: text(groupHeading ?? li), steps: [] };
        recipe.directionGroups.push(group);
        continue;
      }
      const html = li.innerHTML.trim();
      if (html) group.steps.push(html);
    }
    recipe.directionGroups = recipe.directionGroups.filter((g) => g.steps.length || g.title);
  }

  const notes = card.querySelector(".recipe-card-notes");
  if (notes) {
    recipe.notesTitle = text(notes.querySelector(".notes-title"));
    for (const li of notes.querySelectorAll("ul > li, ol > li")) {
      const html = li.innerHTML.trim();
      if (html) recipe.notes.push(html);
    }
  }

  const video = card.querySelector(".recipe-card-video");
  if (video) recipe.videoHtml = video.innerHTML.trim();

  card.replaceWith('<div data-recipe-slot="1"></div>');
  return recipe;
}
