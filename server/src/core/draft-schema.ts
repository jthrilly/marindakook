import { z } from "zod";

// A draft is authoring state, NOT a publishable Post. During an interview most
// content arrives incrementally, so every content field here is optional and
// nested structures are lenient — a half-finished draft (even just a title)
// must validate. Publish-time completeness is a SEPARATE concern: `publish`
// (Task 6) assembles a full Post from the draft, fills the server-managed
// fields (id, final slug, date/modified, commentStatus, comments, featured
// renditions) and runs `postSchema.parse` — that is where required fields are
// enforced, never here. The shapes below deliberately mirror
// content-schema.ts / source-hash.ts by hand rather than `.partial()`-ing the
// strict schemas, so the draft contract can stay loose independently of the
// published contract.

const draftSeoSchema = z.strictObject({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
});

// Recipe content the interview fills in over time. Mirrors recipeSchema but
// every field is optional; `image` is omitted because the recipe card image is
// derived from the hero photo at publish, not authored in the draft.
// Exported so the preview page (D8) can re-parse the same loose shape out of
// an English translation-job candidate — one schema, not a hand-rolled twin.
export const draftRecipeSchema = z.strictObject({
  style: z.string().optional(),
  title: z.string().optional(),
  author: z.string().nullable().optional(),
  courses: z.array(z.string()).optional(),
  cuisines: z.array(z.string()).optional(),
  difficulties: z.array(z.string()).optional(),
  summaryHtml: z.string().nullable().optional(),
  details: z
    .array(
      z.strictObject({
        icon: z.strictObject({ set: z.string(), name: z.string() }).nullable().optional(),
        label: z.string().optional(),
        pairs: z
          .array(z.strictObject({ value: z.string().optional(), unit: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  ingredientsTitle: z.string().nullable().optional(),
  ingredientGroups: z
    .array(
      z.strictObject({
        title: z.string().nullable().optional(),
        items: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  directionsTitle: z.string().nullable().optional(),
  directionGroups: z
    .array(
      z.strictObject({
        title: z.string().nullable().optional(),
        steps: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  notesTitle: z.string().nullable().optional(),
  notes: z.array(z.string()).optional(),
  videoHtml: z.string().nullable().optional(),
});

// Interview meta-state: which required questions are answered (`settled`) vs
// outstanding (`pending`), the most recent skryfhulp prose, the staged hero
// photo reference, and whether the author asked for the post on the voorblad.
const interviewSchema = z.strictObject({
  settled: z.array(z.string()),
  pending: z.array(z.string()),
  latestProse: z.string().optional(),
  heroPhoto: z.string().optional(),
  featured: z.boolean(),
});

export const draftPostSchema = z.strictObject({
  draftId: z.string(),
  kind: z.literal("post"),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string().optional(),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  categories: z.array(z.number().int()).optional(),
  tags: z.array(z.number().int()).optional(),
  html: z.string().optional(),
  seo: draftSeoSchema.optional(),
  recipe: draftRecipeSchema.optional(),
  interview: interviewSchema.optional(),
});

// Editable site-chrome text (the Afrikaans source the en chrome translation
// tracks). Mirrors the field set of siteChromeHashOf's SiteChromeSource, every
// field optional so a chrome edit can touch one string at a time. The chrome
// tools (Task 6) are the authority on the full editable set.
const draftNavItemSchema = z.strictObject({
  label: z.string().optional(),
  path: z.string().optional(),
});

const draftSiteChromeSchema = z.strictObject({
  tagline: z.string().optional(),
  nav: z
    .strictObject({
      top: z.array(draftNavItemSchema).optional(),
      main: z.array(draftNavItemSchema).optional(),
    })
    .optional(),
  bio: z
    .strictObject({
      about: z.string().optional(),
      button: z.strictObject({ label: z.string().optional() }).optional(),
    })
    .optional(),
  sidebar: z
    .strictObject({
      tabs: z
        .strictObject({ views: z.string().optional(), comments: z.string().optional() })
        .optional(),
      featurePosts: z.strictObject({ title: z.string().optional() }).optional(),
      socialWidget: z
        .strictObject({ title: z.string().optional(), description: z.string().optional() })
        .optional(),
      categoriesWidget: z.strictObject({ title: z.string().optional() }).optional(),
    })
    .optional(),
  home: z
    .strictObject({ sectionTitle: z.string().optional(), readMore: z.string().optional() })
    .optional(),
  newsletter: z
    .strictObject({
      heading: z.string().optional(),
      placeholder: z.string().optional(),
      button: z.string().optional(),
    })
    .optional(),
});

export const chromeDraftSchema = z.strictObject({
  draftId: z.string(),
  kind: z.literal("chrome"),
  site: draftSiteChromeSchema,
  updatedAt: z.string(),
});

export type DraftPost = z.infer<typeof draftPostSchema>;
export type ChromeDraft = z.infer<typeof chromeDraftSchema>;
export type DraftRecipe = z.infer<typeof draftRecipeSchema>;
