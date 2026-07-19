"use client";

import { useState } from "react";
import Link from "next/link";
import type { NavItem } from "@/lib/types";

export function MobileNav({
  main,
  top,
  currentPath,
}: {
  main: NavItem[];
  top: NavItem[];
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-3 text-accent"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          {open ? (
            <path d="m5 5 14 14M19 5 5 19" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
        <span className="text-[15px] font-medium uppercase tracking-wide">Menu</span>
      </button>
      {open && (
        <nav className="border-t border-peach-soft bg-white pb-4">
          <ul>
            {[...main, ...top].map((item) => (
              <li key={item.path} className="border-b border-peach-soft">
                <Link
                  href={item.path}
                  className={`block px-5 py-3 text-[15px] uppercase tracking-wide text-accent ${
                    currentPath === item.path ? "font-bold" : ""
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
