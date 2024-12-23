import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";
import { routing } from "@/i18n/routing";
import { getCachedItem } from "@/app/api/cache";
import { ItemGetResponse } from "@/app/api/item/types";

export async function generateStaticParams() {
	if (process.env.SHOULD_GENERATE_STATIC_PAGES === "true") {
		const documents = await db.query.item.findMany({
			columns: {
				key: true,
				parentItem: true,
			},
		});
		
		
		return documents.flatMap((item) => 
			routing.locales.map((locale) => ({
				locale,
				key: item.parentItem ? item.parentItem : item.key,
			}))
		);
	}
	return [];
}

export default async function ItemPage({
	params,
}: {
	params: { key: string };
}) {
	const data = await getCachedItem(params.key).catch(() => ({ item: undefined }));

	return <ItemComponent data={data as ItemGetResponse} />;
}
