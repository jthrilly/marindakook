import Link from "next/link";
import { RootDocument } from "@/components/RootDocument";
import { getDict } from "@/lib/i18n";

export const metadata = { title: "404 - Marinda Kook" };

export default function GlobalNotFound() {
  const af = getDict("af");
  const en = getDict("en");
  return (
    <RootDocument locale="af">
      <main className="mx-auto flex min-h-screen max-w-[700px] flex-col items-center justify-center px-4 text-center">
        <p className="font-script text-[80px] leading-none text-accent">404</p>
        <h1 className="mt-6 text-[32px] font-normal">{af.notFoundTitle}</h1>
        <p className="mt-4">{af.notFoundText}</p>
        <p className="mt-2 text-[15px] text-meta">{en.notFoundText}</p>
        <Link href="/" className="mt-8 inline-block bg-accent px-[17px] py-[6px] text-[15px] text-white transition-colors hover:bg-navy">
          {af.backHome} / {en.backHome}
        </Link>
      </main>
    </RootDocument>
  );
}
