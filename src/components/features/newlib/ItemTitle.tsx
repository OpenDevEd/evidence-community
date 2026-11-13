"use client";

import { Item } from "@/app/api/item/types";
import { Skeleton } from "@/components/nextui/Skeleton";
import { use } from "react";
import { LoadingContext } from "./ItemPage";

const decodeHTMLEntities = (text: string) => {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
		.replace(/&#x([0-9A-F]+);/gi, (_, hex) =>
			String.fromCharCode(parseInt(hex, 16))
		)
		.replace(/<[^>]*>?/g, "");
};

export default function ItemTitle({ item, loadingProp }: { item: Item | undefined, loadingProp?: boolean }) {
	const { loading: contextLoading } = use(LoadingContext);
	const loading = loadingProp ?? contextLoading;

	const escapedTitle = decodeHTMLEntities(item?.title || "");
	// The stand-in drawn before the record arrives is the same size but no heading: a crawler that runs no scripts reads
	// the page as it is sent, placeholders first, and would take "-" for the page's title.
	const Heading = item ? "h1" : "div";

	return (
		<Skeleton isLoaded={!loading} className="rounded-2xl w-full min-h-9">
			<Heading className="text-3xl font-medium" aria-hidden={item ? undefined : true}>{escapedTitle || "-"}</Heading>
		</Skeleton>
	);
}
