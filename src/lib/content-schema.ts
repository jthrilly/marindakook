import { z } from "zod";

export type Locale = "af" | "en";

const imageRefSchema = z.strictObject({
  src: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

const featuredImageSchema = z.strictObject({
  alt: z.string(),
  card: imageRefSchema.nullable(),
  portrait: imageRefSchema.nullable(),
  thumb: imageRefSchema.nullable(),
});

const seoSchema = z.strictObject({
  title: z.string(),
  description: z.string().nullable(),
});

const recipeDetailSchema = z.strictObject({
  icon: z.strictObject({ set: z.string(), name: z.string() }).nullable(),
  label: z.string(),
  pairs: z.array(z.strictObject({ value: z.string(), unit: z.string() })),
});

const recipeSchema = z.strictObject({
  style: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  image: z
    .strictObject({
      src: z.string(),
      srcset: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      alt: z.string(),
    })
    .nullable(),
  courses: z.array(z.string()),
  cuisines: z.array(z.string()),
  difficulties: z.array(z.string()),
  summaryHtml: z.string().nullable(),
  details: z.array(recipeDetailSchema),
  ingredientsTitle: z.string().nullable(),
  ingredientGroups: z.array(
    z.strictObject({ title: z.string().nullable(), items: z.array(z.string()) }),
  ),
  directionsTitle: z.string().nullable(),
  directionGroups: z.array(
    z.strictObject({ title: z.string().nullable(), steps: z.array(z.string()) }),
  ),
  notesTitle: z.string().nullable(),
  notes: z.array(z.string()),
  videoHtml: z.string().nullable(),
});

const commentSchema = z.strictObject({
  id: z.number().int(),
  parent: z.number().int(),
  author: z.string(),
  avatar: z.string().nullable(),
  date: z.string(),
  html: z.string(),
});

export const postSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  modified: z.string(),
  excerpt: z.string(),
  categories: z.array(z.number().int()),
  tags: z.array(z.number().int()),
  featured: featuredImageSchema.nullable(),
  commentStatus: z.string(),
  seo: seoSchema,
  html: z.string(),
  recipe: recipeSchema.nullable(),
  comments: z.array(commentSchema),
});

export type ImageRef = z.infer<typeof imageRefSchema>;
export type FeaturedImage = z.infer<typeof featuredImageSchema>;
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Post = z.infer<typeof postSchema>;
