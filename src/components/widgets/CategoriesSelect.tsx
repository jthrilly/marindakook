"use client";

export function CategoriesSelect({
  options,
  label,
}: {
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) window.location.href = e.target.value;
      }}
      className="w-full cursor-pointer border border-peach-mid bg-white px-3 py-2.5 text-[15px] text-body outline-none focus:border-accent"
    >
      <option value="" disabled>
        {label}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
