import { notFound } from "next/navigation";
import type { ItemGetResponse } from "@/app/api/item/types";

/** Answers a missing or hidden record with the not-found page; the page itself is drawn by ItemRoute. */
export default async function ServerComponent(props: { record: Promise<ItemGetResponse | null> }) {
	const data = await props.record;
	if (!data?.item) notFound();
	return null;
}
