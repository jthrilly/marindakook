"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print flex cursor-pointer items-center gap-2 bg-[#222222] px-4 py-2.5 text-[14px] text-white transition-opacity hover:opacity-85"
      title={`${label}...`}
    >
      <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor" aria-hidden>
        <path d="M28 25H25a1 1 0 0 1 0-2h3a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3a1 1 0 0 1 0 2H4a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3h24a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3Z" />
        <path d="M25 31H7a1 1 0 0 1-1-1V20a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1ZM8 29h16v-8H8Z" />
        <path d="M25 9a1 1 0 0 1-1-1V3H8v5a1 1 0 0 1-2 0V2a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1Z" />
        <rect height="2" width="2" x="24" y="11" />
        <rect height="2" width="4" x="18" y="11" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
