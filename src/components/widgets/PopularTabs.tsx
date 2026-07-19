"use client";

import { useId, useRef, useState } from "react";

export function PopularTabs({
  tabs,
}: {
  tabs: { title: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <div className="flex border-b border-peach-soft" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            key={tab.title}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-[15px] font-medium uppercase tracking-wide transition-colors ${
              i === active
                ? "border-accent text-accent"
                : "border-transparent text-meta hover:text-accent"
            }`}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.title}
          hidden={i !== active}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          className="pt-5"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
