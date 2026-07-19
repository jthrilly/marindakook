import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";

export function Pagination({
  page,
  totalPages,
  pathFor,
  dict,
}: {
  page: number;
  totalPages: number;
  pathFor: (page: number) => string;
  dict: Dictionary;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-12 flex items-center justify-between border-t border-peach-soft pt-8" aria-label="Pagination">
      <div>
        {page > 1 && (
          <Link
            href={pathFor(page - 1)}
            rel="prev"
            className="inline-block bg-accent px-[17px] py-[6px] text-[15px] text-white transition-colors hover:bg-navy"
          >
            ← {dict.previousPage}
          </Link>
        )}
      </div>
      <span className="text-[14px] uppercase tracking-[0.1em] text-meta">
        {page} / {totalPages}
      </span>
      <div>
        {page < totalPages && (
          <Link
            href={pathFor(page + 1)}
            rel="next"
            className="inline-block bg-accent px-[17px] py-[6px] text-[15px] text-white transition-colors hover:bg-navy"
          >
            {dict.nextPage} →
          </Link>
        )}
      </div>
    </nav>
  );
}
