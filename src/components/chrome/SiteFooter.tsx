import type { Site } from "@/lib/content-schema";

export function SiteFooter({ site }: { site: Site }) {
  return (
    <footer className="no-print mt-6 border-t border-peach-soft">
      <div className="mx-auto max-w-[1230px] px-4 py-8 text-center text-[15px] text-meta">
        <span>Copyright © {new Date().getFullYear()} {site.name}</span>
        <span>
          {" "}
          —{" "}
          <a href="https://www.wpzoom.com/themes/cookely/" target="_blank" rel="nofollow noopener" className="hover:text-accent">
            Cookely Theme
          </a>{" "}
          by{" "}
          <a href="https://www.wpzoom.com/" target="_blank" rel="nofollow noopener" className="hover:text-accent">
            WPZOOM
          </a>
        </span>
      </div>
    </footer>
  );
}
