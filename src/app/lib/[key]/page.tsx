import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";

export async function generateStaticParams() {
	const documents = await db.query.item.findMany();
	return documents.map((item) => ({ key: item.parentItem ? item.parentItem : item.key }));
}

export default async function ItemPage({
	params,
}: {
	params: { key: string };
}) {
	const data = await getItem(params.key, "meilisearch").catch(() => ({ item: undefined }));

	return <ItemComponent data={data} />;
}
