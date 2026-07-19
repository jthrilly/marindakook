export type Locale = "af" | "en";

export interface ImageRef {
  src: string;
  width: number | null;
  height: number | null;
}

export interface FeaturedImage {
  alt: string;
  card: ImageRef | null;
  portrait: ImageRef | null;
  thumb: ImageRef | null;
}

export interface RecipeDetail {
  icon: { set: string; name: string } | null;
  label: string;
  pairs: { value: string; unit: string }[];
}

export interface Recipe {
  style: string;
  title: string;
  author: string | null;
  image: {
    src: string;
    srcset: string | null;
    width: number | null;
    height: number | null;
    alt: string;
  } | null;
  courses: string[];
  cuisines: string[];
  difficulties: string[];
  summaryHtml: string | null;
  details: RecipeDetail[];
  ingredientsTitle: string | null;
  ingredientGroups: { title: string | null; items: string[] }[];
  directionsTitle: string | null;
  directionGroups: { title: string | null; steps: string[] }[];
  notesTitle: string | null;
  notes: string[];
  videoHtml: string | null;
}

export interface Comment {
  id: number;
  parent: number;
  author: string;
  avatar: string | null;
  date: string;
  html: string;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  categories: number[];
  tags: number[];
  featured: FeaturedImage | null;
  hasRecipe: boolean;
  commentCount: number;
}

export interface Post extends Omit<PostSummary, "hasRecipe"> {
  modified: string;
  commentStatus: string;
  seo: { title: string; description: string | null };
  html: string;
  recipe: Recipe | null;
  comments: Comment[];
}

export interface Page {
  id: number;
  slug: string;
  title: string;
  date: string;
  modified: string;
  seo: { title: string; description: string | null };
  html: string;
}

export interface Term {
  id: number;
  name: string;
  slug: string;
  description: string;
  count: number;
  parent?: number;
}

export interface NavItem {
  label: string;
  path: string;
}

export interface Site {
  wpUrl: string;
  name: string;
  tagline: string;
  logo: { src: string; srcset: string | null; width: number | null; height: number | null } | null;
  nav: { top: NavItem[]; main: NavItem[] };
  social: { network: string; url: string; color: string }[];
  bio: { name: string; about: string; photo: string | null; button: { label: string; path: string } };
  sidebar: {
    tabs: { views: string; comments: string };
    popularViews: { title: string; slug: string }[];
    popularComments: { title: string; slug: string }[];
    featurePosts: { title: string; count: number };
    socialWidget: { title: string; description: string };
    categoriesWidget: { title: string };
  };
  home: { sectionTitle: string; featuredCategory: string; readMore: string };
  newsletter: { heading: string; placeholder: string; button: string; action: string };
  postsPerPage: number;
}

export interface Translation {
  id: number;
  slug: string;
  sourceHash: string;
  title: string;
  excerpt?: string;
  seo: { title: string; description: string | null };
  html: string;
  recipe?: Recipe | null;
}
