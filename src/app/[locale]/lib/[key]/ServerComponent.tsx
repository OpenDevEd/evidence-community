import { notFound } from "next/navigation";
import type { ItemGetResponse } from "@/app/api/item/types";
import { getLibraryConfig } from "@/config/library-config/server";
import { recordStructuredData } from "@/lib/record-structured-data";

/** Answers a missing or hidden record with the not-found page, and gives a found one its structured data; the page itself is drawn by ItemRoute. */
export default async function ServerComponent(props: { record: Promise<ItemGetResponse | null> }) {
	const [data, libraryConfig] = await Promise.all([props.record, getLibraryConfig()]);
	if (!data?.item) notFound();
	// `<` escaped, so a title can't close the script.
	return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(recordStructuredData(data.item, libraryConfig.identity.baseUrl)).replace(/</g, "\\u003c") }} />;
}
