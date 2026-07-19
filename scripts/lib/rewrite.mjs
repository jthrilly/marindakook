import { WP_URL } from "./wp.mjs";

const WP_HOSTS = [WP_URL, WP_URL.replace("https://", "http://"), WP_URL.replace("https://", "https://www.")];

// Paths that must keep pointing at the live WordPress install (dynamic features
// a static site cannot serve).
const KEEP_ON_WP = /^\/(wp-admin|wp-login|shop|product|product-category|cart|checkout|my-account|wpzoom_rcb_print)\b/;

export const mediaUrls = new Set();

export function uploadUrlToLocal(url) {
  const m = url.match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  return `/media/uploads/${m[1].split("?")[0]}`;
}

export function rewriteUrl(url) {
  if (!url) return url;
  let normalized = url;
  for (const host of WP_HOSTS) {
    if (normalized.startsWith(host)) {
      normalized = normalized.slice(host.length) || "/";
      break;
    }
  }
  if (/^(https?:)?\/\//.test(normalized)) return url;
  if (normalized.includes("/wp-content/uploads/")) {
    const local = uploadUrlToLocal(normalized);
    if (local) {
      mediaUrls.add(normalized.split("?")[0]);
      return local;
    }
  }
  if (normalized.startsWith("/wp-content/") || normalized.startsWith("/wp-includes/")) {
    return `${WP_URL}${normalized}`;
  }
  if (KEEP_ON_WP.test(normalized)) return `${WP_URL}${normalized}`;
  return normalized;
}

export function rewriteSrcset(srcset) {
  if (!srcset) return srcset;
  return srcset
    .split(",")
    .map((part) => {
      const [u, size] = part.trim().split(/\s+/);
      return [rewriteUrl(u), size].filter(Boolean).join(" ");
    })
    .join(", ");
}

export function rewriteHtml(root) {
  for (const el of root.querySelectorAll("[href]")) {
    el.setAttribute("href", rewriteUrl(el.getAttribute("href")));
  }
  for (const el of root.querySelectorAll("[src]")) {
    el.setAttribute("src", rewriteUrl(el.getAttribute("src")));
  }
  for (const el of root.querySelectorAll("[srcset]")) {
    el.setAttribute("srcset", rewriteSrcset(el.getAttribute("srcset")));
  }
  for (const el of root.querySelectorAll("img")) {
    el.removeAttribute("decoding");
    if (!el.getAttribute("loading")) el.setAttribute("loading", "lazy");
  }
  return root;
}
