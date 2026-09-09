import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { getDigestPageData } from "@/lib/notifications/public";
import { readSubscription } from "@/lib/notifications/subscriptions";
import DigestPages from "@/components/digests/DigestPages";
import DigestLoading from "@/components/digests/DigestLoading";
import SubscriptionAction from "@/components/digests/SubscriptionAction";

type Props = {params: Promise<{locale: string; slug: string}>; searchParams: Promise<{token?: string}>};
async function Digest({params, searchParams}: Props) {
  await connection();
  const {locale, slug} = await params;
  const {token = ""} = await searchParams;
  const config = await getLibraryConfig();
  const db = await getDatabaseForConfig(config);
  const action = subscriptionAction(slug);
  if (action) return <SubscriptionAction token={token} action={action} locale={locale} />;
  const data = await getDigestPageData(db, config, locale, slug);
  if (slug === "preferences") {
    const subscriber = await readSubscription(db, token);
    if (!subscriber) notFound();
    return <DigestPages data={data} view="preferences" token={token} initial={{email: subscriber.email, weekly: subscriber.weekly, instant: subscriber.instant, confirmed: Boolean(subscriber.confirmedAt)}} />;
  }
  return <PublishedEdition data={data} slug={slug} />;
}
export default function Page(props: Props) {return <Suspense fallback={<DigestLoading />}><Digest {...props} /></Suspense>;}

function PublishedEdition({data, slug}: {data: Awaited<ReturnType<typeof getDigestPageData>>; slug: string}) {
  if (!data.edition) notFound();
  return <DigestPages data={data} view={slug} />;
}

function subscriptionAction(slug: string) {
  return slug === "confirm" || slug === "unsubscribe" ? slug : null;
}
