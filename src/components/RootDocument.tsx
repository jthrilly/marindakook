import { Bad_Script, Esteban, Rubik } from "next/font/google";
import type { Locale } from "@/lib/content-schema";
import "@/app/globals.css";

const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-rubik",
});

const esteban = Esteban({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-esteban",
});

const badScript = Bad_Script({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-badscript",
});

export function RootDocument({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <html lang={locale === "af" ? "af" : "en"}>
      <body className={`${rubik.variable} ${esteban.variable} ${badScript.variable}`}>
        {children}
      </body>
    </html>
  );
}
