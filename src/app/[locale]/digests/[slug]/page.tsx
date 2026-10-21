import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { editionCardKeys, getDigestEdition, listEarlierDigests, pageNumber } from "@/lib/notifications/public";
import { readSubscription } from "@/lib/notifications/subscriptions";
import { citedKeys } from "@/lib/notifications/digest-text";
import { readPublicItems } from "@/lib/search-index/projection";
import { toLightweightItem } from "@/lib/search";
import { publicTagRules } from "@/lib/tags";
import { readAuthorProfiles } from "@/lib/authors/catalog-server";
import DigestPages, { type EditionCardsData } from "@/components/digests/DigestPages";
import SubscriptionAction from "@/components/digests/SubscriptionAction";
import type { Preferences } from "@/components/digests/Subscription";
import { readDigests } from "../read";

type Props = {params: Promise<{locale: string; slug: string}>; searchParams: Promise<{token?: string; page?: string; reviews?: string}>};
export default async function Page({params, searchParams}: Props) {
  const {locale, slug} = await params;
  const current = Promise.resolve(locale);
  const token = searchParams.then(value => value.token ?? "");
  if (slug === "confirm" || slug === "unsubscribe") return <SubscriptionAction token={token} action={slug} locale={locale} />;
  if (slug === "preferences") return <DigestPages view="preferences" token={token} subscriber={readDigests(current, async db => readPreferences(db, await token))} />;
  const page = searchParams.then(value => pageNumber(value.page));
  // The reviews list has pages of its own, kept in `reviews`.
  const reviewsPage = searchParams.then(value => pageNumber(value.reviews));
  const edition = readDigests(current, async (db, config, locale) => getDigestEdition(db, config, locale, slug, await page, await reviewsPage));
  // This page's cards and their authors are read with the page, so nothing loads in the browser.
  const cards = edition.then(value => readDigests(current, (db, config) => readEditionCards(db, config, value ? editionCardKeys(value) : [], value ? citedKeys(value.markdown) : [])));
  return <DigestPages view="edition" slug={slug} earlier={readDigests(current, (db, config, locale) => listEarlierDigests(db, config, locale, slug))} edition={edition} cards={cards} />;
}

async function readEditionCards(db: Database, config: LibraryServerConfig, keys: string[], cited: string[]): Promise<EditionCardsData> {
  // The records the text cites come with the cards, so each citation link shows from the start whether its record is open access.
  const items = await readPublicItems(db, [...new Set([...keys, ...cited])], config);
  const onPage = new Set(keys);
  // Each card keeps what a result card keeps of its files, so it shows its PDF's first page.
  const rules = publicTagRules(config);
  const cards = items.filter(item => onPage.has(item.key)).map(({fullTextPDFs: _text, ...card}) => toLightweightItem(card, rules));
  return {
    cards,
    cited: Object.fromEntries(items.map(item => [item.key, {openAccess: item.openAccess}])),
    profiles: await readAuthorProfiles(cards.flatMap(card => card.creators ?? []).flatMap(creator => creator.authorProfileId ? [creator.authorProfileId] : [])),
  };
}

async function readPreferences(db: Database, token: string): Promise<Preferences | null> {
  const subscriber = await readSubscription(db, token);
  return subscriber && {email: subscriber.email, digest: subscriber.digest, instant: subscriber.instant, confirmed: Boolean(subscriber.confirmedAt)};
}
