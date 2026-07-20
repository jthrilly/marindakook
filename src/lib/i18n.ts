import type { Locale, NavItem, Term } from "./content-schema";
import enCategoryNames from "./en-category-names.json";

export const locales: Locale[] = ["af", "en"];
export const defaultLocale: Locale = "af";

// The live WordPress site shows theme chrome in English (dates, "Print",
// "Comments are Disabled") while content and widget titles are Afrikaans.
// The af dictionary replicates that mix exactly; en is fully English.
const dictionaries = {
  af: {
    searchPlaceholder: "Enter your keywords...",
    searchTitle: "Soek",
    searchResultsFor: "Soekresultate vir",
    searchNoResults: "Geen resultate gevind nie.",
    searchPrompt: "Tik jou soekwoorde hierbo in.",
    readMore: "Read More",
    print: "Print",
    recipeBy: "Recipe by",
    commentsDisabled: "Comments are Disabled",
    commentsClosed: "Comments are closed.",
    commentsTitle: (n: number) => `${n} Comments`,
    oneComment: "1 Comment",
    tagsLabel: "Tags",
    shareTwitter: "Tweet this on Twitter",
    shareFacebook: "Share this on Facebook",
    sharePinterest: "Pin this on Pinterest",
    shareWhatsApp: "Share this on WhatsApp",
    previousPost: "Previous Post",
    nextPost: "Next Post",
    previousPage: "Previous page",
    nextPage: "Next page",
    newsletterInstructions: "Ontvang die nuutste nuus en resepte reguit in jou inbox.",
    newsletterName: "Naam",
    categoryHeading: (name: string) => name,
    tagHeading: (name: string) => name,
    pageSuffix: (n: number) => `Bladsy ${n}`,
    notFoundTitle: "Bladsy nie gevind nie",
    notFoundText: "Die bladsy waarna jy soek bestaan nie. Probeer die soekfunksie of gaan terug tuis toe.",
    backHome: "Terug Tuis",
    languageName: "Afrikaans",
    switchLabel: "English",
    skipToContent: "Slaan oor na inhoud",
  },
  en: {
    searchPlaceholder: "Enter your keywords...",
    searchTitle: "Search",
    searchResultsFor: "Search results for",
    searchNoResults: "No results found.",
    searchPrompt: "Type your search terms above.",
    readMore: "Read More",
    print: "Print",
    recipeBy: "Recipe by",
    commentsDisabled: "Comments are Disabled",
    commentsClosed: "Comments are closed.",
    commentsTitle: (n: number) => `${n} Comments`,
    oneComment: "1 Comment",
    tagsLabel: "Tags",
    shareTwitter: "Tweet this on Twitter",
    shareFacebook: "Share this on Facebook",
    sharePinterest: "Pin this on Pinterest",
    shareWhatsApp: "Share this on WhatsApp",
    previousPost: "Previous Post",
    nextPost: "Next Post",
    previousPage: "Previous page",
    nextPage: "Next page",
    newsletterInstructions: "Get the latest news and recipes straight to your inbox.",
    newsletterName: "Name",
    categoryHeading: (name: string) => name,
    tagHeading: (name: string) => name,
    pageSuffix: (n: number) => `Page ${n}`,
    notFoundTitle: "Page not found",
    notFoundText: "The page you are looking for does not exist. Try the search, or head back home.",
    backHome: "Back Home",
    languageName: "English",
    switchLabel: "Afrikaans",
    skipToContent: "Skip to content",
  },
};

export type Dictionary = (typeof dictionaries)[Locale];

export function getDict(locale: Locale): Dictionary {
  return dictionaries[locale];
}

// English translations of site chrome that site.json stores in Afrikaans.
const enSiteStrings: {
  nav: Record<string, string>;
  widgets: Record<string, string>;
  bioAbout: string;
  socialDescription: string;
  newsletter: { heading: string; placeholder: string; button: string };
  tagline: string;
} = {
  nav: {
    "/": "Home",
    "/category/voorgereg/": "Starters",
    "/category/hoofgereg/": "Mains",
    "/category/nagereg/": "Desserts",
    "/category/bykosse/": "Sides",
    "/category/gebak/": "Baking",
    "/oor-my/": "About Me",
    "/optredes/": "Bookings and Cookbooks",
  },
  widgets: {
    Gewildste: "Most Popular",
    Kommentaar: "Comments",
    "Nuwe Resepte": "New Recipes",
    "Gesels saam": "Join the conversation",
    "Kategoriëe": "Categories",
    "Nuutste Resepte": "Latest Recipes",
    Nuusbrief: "Newsletter",
    "Lees Meer": "Read More",
  },
  bioAbout:
    "This is no fancy food blog. It's just a simple website so that my children and their friends, and their friends' friends, can learn to cook. So they don't have to phone me quite so often to ask: how does one make…",
  socialDescription: "Follow all of Marinda's antics on social media. Come join the conversation!",
  newsletter: {
    heading: "Newsletter",
    placeholder: "Email address",
    button: "Sign Up",
  },
  tagline: "Easy South African Recipes",
};

export function localizeNav(items: NavItem[], locale: Locale): NavItem[] {
  if (locale === "af") return items;
  return items.map((item) => ({
    ...item,
    label: enSiteStrings.nav[item.path] ?? item.label,
  }));
}

export function localizeWidgetTitle(title: string, locale: Locale): string {
  if (locale === "af") return title;
  return enSiteStrings.widgets[title.trim()] ?? title;
}

export function localizeSiteStrings(locale: Locale) {
  return locale === "en" ? enSiteStrings : null;
}

// Category display names for the en locale; tags keep their Afrikaans names
// (they are dish keywords with no English source).
export function localizeTermName(term: Term, locale: Locale): string {
  if (locale === "af") return term.name;
  return (enCategoryNames as Record<string, string>)[term.slug] ?? term.name;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

// Matches the live theme's date format: "15th November 2025".
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Comment metadata format on the live theme: "20th December 2013 at 3:56 pm".
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hours24 = d.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "am" : "pm";
  return `${formatDate(iso)} at ${hours}:${minutes} ${meridiem}`;
}
