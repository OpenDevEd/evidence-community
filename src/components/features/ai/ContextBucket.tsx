"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import useSWR from "swr";
import type { ItemGetResponse } from "@/app/api/item/types";
import Resource from "@/components/features/items/Resource";
import { useInlineChatLayout, type BucketEntry } from "@/context/InlineChatLayout";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { fetcher } from "@/lib/utils";

function useBucketItem(itemKey: string) {
	const { registerPdfSources } = useInlineChatLayout();
	const { data, isLoading } = useSWR<ItemGetResponse>(
		`/item/${itemKey}`,
		fetcher,
		{ revalidateOnFocus: false },
	);

	useEffect(() => {
		if (!data?.item) return;
		registerPdfSources(
			itemKey,
			publicationPdfCitationSources(itemKey, data.item.attachmentsData),
		);
	}, [data?.item, itemKey, registerPdfSources]);

	return { item: data?.item, isLoading };
}

/**
 * Headless fetcher so PDF citation sources resolve even while the Sources
 * view is not shown. Shares its SWR entry with the visible cards, so nothing
 * is fetched twice.
 */
export function BucketSourcesLoader({ itemKey }: { itemKey: string }) {
	useBucketItem(itemKey);
	return null;
}

function BucketCard({ itemKey }: { itemKey: string }) {
	const { item, isLoading } = useBucketItem(itemKey);

	return (
		<Resource
			itemData={item}
			isLoading={isLoading}
			abstract={false}
			className="my-0 border border-black/[0.05] dark:border-white/[0.06]"
			as="div"
			openLinksInNewTab
		/>
	);
}

/**
 * The publications the model has touched during the inline chat, most
 * recently touched first. Rendered by the Sources view of the engaged
 * library panel.
 */
export function BucketList({ entries }: { entries: BucketEntry[] }) {
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<AnimatePresence initial={false} mode="popLayout">
				{entries.map((entry) => (
					<motion.div
						key={entry.key}
						layout
						// Only re-measure when the bucket itself changes, not
						// on every parent render while the chat streams.
						layoutDependency={entries}
						initial={{ opacity: 0, y: -24, scale: 0.96 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, scale: 0.96 }}
						transition={{
							type: "spring",
							bounce: 0.25,
							duration: 0.55,
						}}
					>
						<BucketCard itemKey={entry.key} />
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
