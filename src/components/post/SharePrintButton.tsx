"use client";

export function SharePrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="cursor-pointer bg-accent px-4 py-1.5 text-[14px] text-white transition-colors hover:bg-navy"
    >
      {label}
    </button>
  );
}
