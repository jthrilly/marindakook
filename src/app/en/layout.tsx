import { RootDocument } from "@/components/RootDocument";

export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}
