import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDigestEdition, listEarlierDigests, pageNumber } from "@/lib/notifications/public";
import { readSubscription } from "@/lib/notifications/subscriptions";
import { readPublicItems } from "@/lib/search-index/projection";
import { forwardAuthorProfileRequest } from "@/lib/authors/catalog-server";
import { parseAuthorCatalog, type AuthorProfile } from "@/lib/authors/profiles";
import DigestPages, { type EditionCardsData } from "@/components/digests/DigestPages";
import SubscriptionAction from "@/components/digests/SubscriptionAction";
import type { Preferences } from "@/components/digests/Subscription";
import { readDigests } from "../read";

type Props = {params: Promise<{locale: string; slug: string}>; searchParams: Promise<{token?: string; page?: string}>};
export default async function Page({params, searchParams}: Props) {
  const {locale, slug} = await params;
  const current = Promise.resolve(locale);
  const token = searchParams.then(value => value.token ?? "");
  if (slug === "confirm" || slug === "unsubscribe") return <SubscriptionAction token={token} action={slug} locale={locale} />;
  if (slug === "preferences") return <DigestPages view="preferences" token={token} subscriber={readDigests(current, async db => readPreferences(db, await token))} />;
  const page = searchParams.then(value => pageNumber(value.page));
  const edition = readDigests(current, async (db, config, locale) => getDigestEdition(db, config, locale, slug, await page));
  // This page's cards and their authors are read with the page, so nothing loads in the browser.
  const cards = edition.then(value => readDigests(current, (db, config) => readEditionCards(db, config, value?.keys ?? [])));
  return <DigestPages view="edition" slug={slug} earlier={readDigests(current, (db, config, locale) => listEarlierDigests(db, config, locale, slug))} edition={edition} cards={cards} />;
}

async function readEditionCards(db: Database, config: LibraryServerConfig, keys: string[]): Promise<EditionCardsData> {
  const items = await readPublicItems(db, keys, config);
  const cards = items.map(({fullTextPDFs: _text, attachmentsData: _files, ...card}) => card);
  return {cards, profiles: await readAuthorProfiles(cards.flatMap(card => card.creators ?? []).flatMap(creator => creator.authorProfileId ? [creator.authorProfileId] : []))};
}

/** Profiles for the page's authors; the cards keep their stored names if the catalog is unavailable. */
async function readAuthorProfiles(ids: string[]): Promise<AuthorProfile[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const batches = await Promise.all(Array.from({length: Math.ceil(unique.length / 100)}, async (_, index) => {
    const response = await forwardAuthorProfileRequest({operation: "resolve", profileIds: unique.slice(index * 100, (index + 1) * 100)});
    return response.ok ? parseAuthorCatalog(await response.json()).profiles : [];
  }));
  return batches.flat();
}

async function readPreferences(db: Database, token: string): Promise<Preferences | null> {
  const subscriber = await readSubscription(db, token);
  return subscriber && {email: subscriber.email, digest: subscriber.digest, instant: subscriber.instant, confirmed: Boolean(subscriber.confirmedAt)};
}
