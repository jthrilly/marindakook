export const WP_URL = process.env.WP_URL ?? "https://marindakook.co.za";

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "marindakook-static-sync/1.0" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastError;
}

export async function getJson(path) {
  const res = await fetchWithRetry(`${WP_URL}/wp-json${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

export async function getAllPaged(path, { perPage = 100, onPage } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetchWithRetry(
      `${WP_URL}/wp-json${path}${sep}per_page=${perPage}&page=${page}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path} page ${page}`);
    const items = await res.json();
    all.push(...items);
    onPage?.(page, all.length);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? 1);
    if (page >= totalPages) break;
  }
  return all;
}

export async function getHtml(path) {
  const res = await fetchWithRetry(`${WP_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.text();
}
