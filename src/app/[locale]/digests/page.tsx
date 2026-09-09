import { Suspense } from "react";
import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { getDigestPageData } from "@/lib/notifications/public";
import DigestPages from "@/components/digests/DigestPages";

async function Archive({params}: {params: Promise<{locale: string}>}) {
  await connection();
  const {locale} = await params;
  const config = await getLibraryConfig();
  const data = await getDigestPageData(await getDatabaseForConfig(config), config, locale);
  return <DigestPages data={data} />;
}
export default function Page(props: {params: Promise<{locale: string}>}) {
  return <Suspense><Archive {...props} /></Suspense>;
}
