import type { Site } from "@/lib/content-schema";

const ICON_PATHS: Record<string, React.ReactNode> = {
  facebook: (
    <path d="M13.5 9H15V6.5h-2c-2 0-3 1.3-3 3.2V11H8v2.5h2V22h3v-8.5h2.2l.4-2.5H13v-1.2c0-.5.2-.8.5-.8Z" />
  ),
  instagram: (
    <>
      <path
        d="M9 5.5h6A3.5 3.5 0 0 1 18.5 9v6a3.5 3.5 0 0 1-3.5 3.5H9A3.5 3.5 0 0 1 5.5 15V9A3.5 3.5 0 0 1 9 5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15.9" cy="8.2" r="1.05" />
    </>
  ),
  youtube: (
    <path d="M20.5 8.4a2.2 2.2 0 0 0-1.6-1.6C17.6 6.5 12 6.5 12 6.5s-5.6 0-7 .3A2.2 2.2 0 0 0 3.5 8.4 23 23 0 0 0 3.2 12a23 23 0 0 0 .3 3.6 2.2 2.2 0 0 0 1.6 1.6c1.3.3 6.9.3 6.9.3s5.6 0 7-.3a2.2 2.2 0 0 0 1.6-1.6 23 23 0 0 0 .3-3.6 23 23 0 0 0-.4-3.6ZM10.3 14.6V9.4l4.7 2.6Z" />
  ),
};

export function SocialIcons({
  social,
  size = 37,
}: {
  social: Site["social"];
  size?: number;
}) {
  return (
    <ul className="flex items-center gap-2">
      {social.map((item) => (
        <li key={item.network}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener"
            aria-label={item.network}
            className="flex items-center justify-center rounded-full text-white transition-opacity hover:opacity-80"
            style={{ backgroundColor: item.color, width: size, height: size }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width={size * 0.62} height={size * 0.62} aria-hidden>
              {ICON_PATHS[item.network] ?? <circle cx="12" cy="12" r="6" />}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
