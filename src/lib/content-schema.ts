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

export const pageSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  modified: z.string(),
  seo: seoSchema,
  html: z.string(),
});

export const translationSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  sourceHash: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  seo: seoSchema,
  html: z.string(),
  recipe: recipeSchema.nullable().optional(),
});

const navItemSchema = z.strictObject({ label: z.string(), path: z.string() });

export const siteSchema = z.strictObject({
  name: z.string(),
  tagline: z.string(),
  logo: z
    .strictObject({
      src: z.string(),
      srcset: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    })
    .nullable(),
  nav: z.strictObject({ top: z.array(navItemSchema), main: z.array(navItemSchema) }),
  social: z.array(z.strictObject({ network: z.string(), url: z.string(), color: z.string() })),
  bio: z.strictObject({
    name: z.string(),
    about: z.string(),
    photo: z.string().nullable(),
    button: z.strictObject({ label: z.string(), path: z.string() }),
  }),
  sidebar: z.strictObject({
    tabs: z.strictObject({ views: z.string(), comments: z.string() }),
    popularViews: z.array(z.strictObject({ title: z.string(), slug: z.string() })),
    popularComments: z.array(z.strictObject({ title: z.string(), slug: z.string() })),
    featurePosts: z.strictObject({ title: z.string(), count: z.number().int() }),
    socialWidget: z.strictObject({ title: z.string(), description: z.string() }),
    categoriesWidget: z.strictObject({ title: z.string() }),
  }),
  home: z.strictObject({
    sectionTitle: z.string(),
    featuredCategory: z.string(),
    readMore: z.string(),
  }),
  newsletter: z.strictObject({
    heading: z.string(),
    placeholder: z.string(),
    button: z.string(),
    action: z.string(),
  }),
  postsPerPage: z.number().int(),
});

const termSchema = z.strictObject({
  id: z.number().int(),
  description: z.string(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().int().optional(),
});

export const termsFileSchema = z.strictObject({
  categories: z.array(termSchema),
  tags: z.array(termSchema),
});

export type ImageRef = z.infer<typeof imageRefSchema>;
export type FeaturedImage = z.infer<typeof featuredImageSchema>;
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Post = z.infer<typeof postSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Translation = z.infer<typeof translationSchema>;
export type NavItem = z.infer<typeof navItemSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Term = z.infer<typeof termSchema> & { count: number };
