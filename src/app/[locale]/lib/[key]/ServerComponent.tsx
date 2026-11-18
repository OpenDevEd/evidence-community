import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ItemGetResponse } from "@/app/api/item/types";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { recordStructuredData } from "@/lib/record-structured-data";
import { readWithdrawnRecord } from "@/lib/withdrawn-record";
import WithdrawnRecord from "@/components/layout/WithdrawnRecord";

/**
 * Answers a missing or hidden record with the not-found page, and a withdrawn one, which its DOI still leads to, with
 * its tombstone; gives a found one its structured data. The page itself is drawn by ItemRoute.
 */
export default async function ServerComponent(props: { record: Promise<ItemGetResponse | null>; recordKey: Promise<string> }) {
	const data = await props.record;
	// The library's settings are read per request, never while the build prerenders this page.
	await connection();
	const libraryConfig = await getLibraryConfig();
	if (!data?.item) {
		const withdrawn = await readWithdrawnRecord(await getDatabaseForConfig(libraryConfig), await props.recordKey, libraryConfig);
		if (!withdrawn) notFound();
		return <WithdrawnRecord record={withdrawn} />;
	}
	// `<` escaped, so a title can't close the script.
	return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(recordStructuredData(data.item, libraryConfig.identity.baseUrl)).replace(/</g, "\\u003c") }} />;
}
