"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import useSWR from "swr";

import type { ItemsBatchResponse } from "@/app/api/items/batch/route";
import type { ListItem } from "@/app/api/item/types";
import Resource from "@/components/features/items/Resource";
import type { BucketEntry } from "@/context/InlineChatLayout";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { fetcherPOST } from "@/lib/utils";

export type BucketPublication = ListItem;
export type BucketPublications = {
	byKey: Record<string, BucketPublication>;
	isLoading: boolean;
	/** Where the cited PDF pages live, for every publication loaded so far. */
	pdfSources: Record<string, string>;
};

/** Room for every publication one conversation could reasonably touch. */
const BUCKET_PAGE_SIZE = 200;

/**
 * The publications the assistant has used, loaded together in one request.
 *
 * Where each one's cited pages live is worked out from that data while the
 * page is drawn, so it can never fall behind the conversation, and clearing
 * the conversation clears it with no help from anyone.
 *
 * The request is keyed by the publications themselves, sorted, so reusing a
 * publication that is already loaded reorders the list without fetching it
 * again.
 */
export function useBucketPublications(
	entries: BucketEntry[],
): BucketPublications {
	const wanted = [...new Set(entries.map((entry) => entry.key))].sort();
	const { data, isLoading } = useSWR<ItemsBatchResponse>(
		wanted.length > 0
			? [
					"/items/batch",
					{
						keys: wanted,
						page: 1,
						perPage: BUCKET_PAGE_SIZE,
						includeHeavyFields: true,
					},
				]
			: null,
		fetcherPOST,
		{
			keepPreviousData: true,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);

	const items = data?.items;

	return useMemo(() => {
		const byKey: Record<string, BucketPublication> = {};
		const pdfSources: Record<string, string> = {};
		for (const item of items ?? []) {
			if (!item.key) continue;
			byKey[item.key] = item;
			Object.assign(
				pdfSources,
				publicationPdfCitationSources(item.key, item.attachmentsData),
			);
		}

		return { byKey, isLoading, pdfSources };
	}, [isLoading, items]);
}

function BucketCard({
	item,
	isLoading,
}: {
	item?: BucketPublication;
	isLoading: boolean;
}) {
	return (
		<Resource
			itemData={item}
			isLoading={isLoading}
			abstract={false}
			className="my-0 border border-black/[0.05] dark:border-white/[0.06]"
			as="div"
		/>
	);
}

/**
 * The publications the assistant has used in this conversation, most recently
 * used first. Shown beside the chat in the split view.
 */
export function BucketList({
	entries,
	publications,
}: {
	entries: BucketEntry[];
	publications: BucketPublications;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<AnimatePresence initial={false} mode="popLayout">
				{entries.map((entry) => (
					<motion.div
						key={entry.key}
						layout
						// Only measure again when the list itself changes, not
						// on every render while an answer is arriving.
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
						<BucketCard
							item={publications.byKey[entry.key]}
							isLoading={publications.isLoading}
						/>
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
