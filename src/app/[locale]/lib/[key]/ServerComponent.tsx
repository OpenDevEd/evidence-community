import { notFound } from "next/navigation";
import { RefreshPrefetchedItem } from "@/components/features/newlib/RefreshPrefetchedItem";
import type { ItemGetResponse } from "@/app/api/item/types";

/** Answers a missing or hidden record with the not-found page; the page itself is drawn by ItemRoute. */
export default async function ServerComponent(props: {
	params: Promise<{ key: string }>;
	record: Promise<ItemGetResponse | null>;
}) {
	const [{ key }, data] = await Promise.all([props.params, props.record]);
	if (!data?.item) notFound();
	return <RefreshPrefetchedItem itemKey={key} />;
}
