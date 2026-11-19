"use client";

import { Item } from "@/app/api/item/types";
import { Skeleton } from "@/components/nextui/Skeleton";
import { use } from "react";
import { LoadingContext } from "./ItemPage";
import { ItemTranslationToggle, useItemTranslation } from "@/components/features/translation/ResultsTranslation";
import { twMerge } from "tailwind-merge";

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
	// Try to use context, but fallback to prop if context is not available or fails
	let loading = loadingProp;
	
	try {
		// We need to handle the case where this component is used outside of ItemPage
		// where LoadingContext might not be provided.
		// However, since LoadingContext has a default value, use() should work.
		// But to be safe and flexible, we allow passing loading as a prop.
		if (loading === undefined) {
			const context = use(LoadingContext);
			loading = context.loading;
		}
	} catch (e) {
		// Fallback if context usage fails (though unlikely with default value)
		loading = loading ?? false;
	}

	const translation = useItemTranslation(item?.key);
	const translated = translation && !translation.pending && !translation.showingOriginal ? translation : null;
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
