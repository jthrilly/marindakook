import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import { formatDateTime } from "@/lib/i18n";
import { absoluteUrl, asset, localePath, postPath, tagPath } from "@/lib/paths";
import type { Comment, Locale, Post, PostSummary, Site, Term } from "@/lib/types";
import { SharePrintButton } from "./SharePrintButton";

export function TagList({ ids, tags, locale }: { ids: number[]; tags: Term[]; locale: Locale }) {
  const items = ids.map((id) => tags.find((t) => t.id === id)).filter((t): t is Term => Boolean(t));
  if (!items.length) return null;
  return (
    <div className="mt-10 flex flex-wrap items-center gap-2">
      {items.map((tag) => (
        <Link
          key={tag.id}
          href={tagPath(locale, tag.slug)}
          className="border border-peach-mid px-3 py-1 text-[13px] uppercase tracking-wide text-meta transition-colors hover:border-accent hover:text-accent"
        >
          {tag.name}
        </Link>
      ))}
    </div>
  );
}

export function ShareRow({ post, locale, dict }: { post: Post; locale: Locale; dict: Dictionary }) {
  const url = absoluteUrl(asset(postPath(locale, post.slug)));
  const encoded = encodeURIComponent(url);
  const text = encodeURIComponent(post.title);
  const image = post.featured?.card ? encodeURIComponent(absoluteUrl(asset(post.featured.card.src))) : "";
  const links = [
    { label: "Twitter", title: dict.shareTwitter, href: `https://twitter.com/intent/tweet?url=${encoded}&text=${text}` },
    { label: "Facebook", title: dict.shareFacebook, href: `https://facebook.com/sharer.php?u=${encoded}&t=${text}` },
    { label: "Pinterest", title: dict.sharePinterest, href: `https://pinterest.com/pin/create/button/?url=${encoded}&media=${image}&description=${text}` },
  ];
  return (
    <div className="mt-8 flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener nofollow"
          title={l.title}
          className="bg-accent px-4 py-1.5 text-[14px] text-white transition-colors hover:bg-navy"
        >
          {l.label}
        </a>
      ))}
      <SharePrintButton label={dict.print} />
    </div>
  );
}

export function AuthorBox({ site, locale }: { site: Site; locale: Locale }) {
  return (
    <div className="mt-12 flex flex-col items-center gap-6 border-y border-peach-soft py-8 sm:flex-row sm:items-start">
      {site.bio.photo && (
        <img
          src={asset(site.bio.photo)}
          alt={site.bio.name}
          width={110}
          height={110}
          className="h-[110px] w-[110px] shrink-0 rounded-full object-cover"
        />
      )}
      <div className="text-center sm:text-left">
        <h3 className="font-serif text-[22px]">{site.bio.name}</h3>
        <p className="mt-2 text-[15px] leading-relaxed">{site.bio.about}</p>
        <Link href={localePath(locale, site.bio.button.path)} className="mt-2 inline-block text-[15px] text-accent hover:text-ink">
          {site.bio.button.label} →
        </Link>
      </div>
    </div>
  );
}

export function PrevNext({
  prev,
  next,
  locale,
  dict,
}: {
  prev: PostSummary | null;
  next: PostSummary | null;
  locale: Locale;
  dict: Dictionary;
}) {
  if (!prev && !next) return null;
  return (
    <nav className="mt-10 grid gap-6 sm:grid-cols-2" aria-label="Posts">
      <div>
        {prev && (
          <Link href={postPath(locale, prev.slug)} rel="prev" className="group block">
            <span className="text-[13px] uppercase tracking-[0.12em] text-meta">← {dict.previousPost}</span>
            <span className="mt-1 block text-[18px] text-ink transition-colors group-hover:text-accent">{prev.title}</span>
          </Link>
        )}
      </div>
      <div className="sm:text-right">
        {next && (
          <Link href={postPath(locale, next.slug)} rel="next" className="group block">
            <span className="text-[13px] uppercase tracking-[0.12em] text-meta">{dict.nextPost} →</span>
            <span className="mt-1 block text-[18px] text-ink transition-colors group-hover:text-accent">{next.title}</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

export function CommentList({ comments, dict }: { comments: Comment[]; dict: Dictionary }) {
  if (!comments.length) return null;
  const byParent = new Map<number, Comment[]>();
  for (const c of comments) {
    const list = byParent.get(c.parent) ?? [];
    list.push(c);
    byParent.set(c.parent, list);
  }

  function Thread({ parent, depth }: { parent: number; depth: number }) {
    const items = byParent.get(parent);
    if (!items?.length) return null;
    return (
      <ul className={depth > 0 ? "mt-5 space-y-5 border-l-2 border-peach-soft pl-5 sm:pl-8" : "space-y-7"}>
        {items.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-3">
              {c.avatar && (
                <img src={c.avatar} alt="" width={48} height={48} loading="lazy" className="h-12 w-12 rounded-full" />
              )}
              <div>
                <span className="block font-medium text-ink">{c.author}</span>
                <time dateTime={c.date} className="text-[13px] text-meta">
                  {formatDateTime(c.date)}
                </time>
              </div>
            </div>
            <div className="comment-body-html mt-2" dangerouslySetInnerHTML={{ __html: c.html }} />
            <Thread parent={c.id} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="mt-12" id="comments">
      <h2 className="mb-6 text-[26px] font-normal">
        {comments.length === 1 ? dict.oneComment : dict.commentsTitle(comments.length)}
      </h2>
      <Thread parent={0} depth={0} />
      <p className="mt-8 text-[15px] italic text-meta">{dict.commentsClosed}</p>
    </section>
  );
}
