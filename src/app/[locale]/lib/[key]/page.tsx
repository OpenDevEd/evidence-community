import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";

export async function generateStaticParams() {
	if (process.env.SHOULD_GENERATE_STATIC_PAGES === "true") {
		const documents = await db.query.item.findMany();
		return documents.map((item) => ({ key: item.parentItem ? item.parentItem : item.key }));
	}
	return [];
}

export default async function ItemPage({
	params,
}: {
	params: { key: string };
}) {
	const data = await getItem(params.key, "meilisearch").catch(() => ({ item: undefined }));

	return <ItemComponent data={data} />;
}
