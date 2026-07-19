import { RootDocument } from "@/components/RootDocument";

export default function AfrikaansLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="af">{children}</RootDocument>;
}
