import type { Metadata } from "next";
import { allRoutePaths, renderRoute, routeMetadata } from "@/lib/router";

export const dynamicParams = false;

export async function generateStaticParams() {
  const paths = await allRoutePaths();
  return paths.map((slug) => ({ slug: slug.length ? slug : undefined }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return routeMetadata("af", slug ?? []);
}

export default async function AfrikaansPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return renderRoute("af", slug ?? []);
}
