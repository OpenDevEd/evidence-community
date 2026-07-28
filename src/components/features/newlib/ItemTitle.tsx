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

	return (
		<Skeleton isLoaded={!loading} className="rounded-2xl w-full min-h-9">
			<h1 className="text-3xl font-medium">{escapedTitle || "-"}</h1>
		</Skeleton>
	);
}
