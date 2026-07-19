"use client";

import { useState } from "react";

export function PopularTabs({
  tabs,
}: {
  tabs: { title: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="flex border-b border-peach-soft" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.title}
            role="tab"
            aria-selected={i === active}
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
        <div key={tab.title} hidden={i !== active} role="tabpanel" className="pt-5">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
