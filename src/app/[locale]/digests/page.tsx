import { getLatestDigest, getNextDigestEdition, listDigestEditions, pageNumber } from "@/lib/notifications/public";
import DigestPages from "@/components/digests/DigestPages";
import { readDigests } from "./read";

type Props = {params: Promise<{locale: string}>; searchParams: Promise<{page?: string}>};
export default function Page({params, searchParams}: Props) {
  const locale = params.then(value => value.locale);
  const page = searchParams.then(value => pageNumber(value.page));
  return <DigestPages view="archive"
    latest={readDigests(locale, getLatestDigest)}
    editions={readDigests(locale, async (db, config, locale) => listDigestEditions(db, config, locale, await page))}
    nextEdition={readDigests(locale, (db, config) => getNextDigestEdition(db, config))} />;
}
