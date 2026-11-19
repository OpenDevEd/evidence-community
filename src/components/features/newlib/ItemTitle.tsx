"use client";

import { Item } from "@/app/api/item/types";
import { Skeleton } from "@/components/nextui/Skeleton";
import { use } from "react";
import { LoadingContext } from "./ItemPage";
import { twMerge } from "tailwind-merge";
import { ItemTranslationToggle, useItemTranslation } from "@/components/features/translation/ResultsTranslation";

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
	// LoadingContext has a default, so this also works outside ItemPage; a passed prop wins.
	const context = use(LoadingContext);
	const loading = loadingProp ?? context.loading;

	const translation = useItemTranslation(item?.key);
	const translated = translation && !translation.showingOriginal ? translation : null;
	const escapedTitle = translated?.title ?? decodeHTMLEntities(item?.title || "");

	return (
		<Skeleton isLoaded={!loading} className="rounded-2xl w-full min-h-9">
			<h1 className={twMerge("text-3xl font-medium transition-opacity", translation?.pending && "opacity-40 animate-pulse")}>
				{escapedTitle || "-"}
			</h1>
			<div className="-ms-2 mt-2 empty:hidden">
				<ItemTranslationToggle itemKey={item?.key} />
			</div>
		</Skeleton>
	);
}
