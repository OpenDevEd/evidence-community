"use client";

import { AnimatePresence, motion } from "framer-motion";
import useSWR from "swr";

import type { ItemGetResponse } from "@/app/api/item/types";
import Resource from "@/components/features/items/Resource";
import type { BucketEntry } from "@/context/InlineChatLayout";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { fetcher } from "@/lib/utils";

export type BucketPublication = NonNullable<ItemGetResponse["item"]>;
export type BucketPublications = {
	byKey: Record<string, BucketPublication>;
	isLoading: boolean;
	/** Where the cited PDF pages live, for every publication loaded so far. */
	pdfSources: Record<string, string>;
};

const NO_PUBLICATIONS: BucketPublications = {
	byKey: {},
	isLoading: false,
	pdfSources: {},
};

/**
 * The publications the assistant has used, loaded once for the whole chat.
 *
 * Where each one's cited pages live is worked out from that data while the
 * page is drawn, so it can never fall behind the conversation, and clearing
 * the conversation clears it with no help from anyone.
 */
export function useBucketPublications(
	entries: BucketEntry[],
): BucketPublications {
	const keys = entries.map((entry) => entry.key);
	const { data, isLoading } = useSWR(
		keys.length > 0 ? ["bucket-publications", ...keys] : null,
		async () => {
			const loaded = await Promise.all(
				keys.map(async (key) => {
					const response = (await fetcher(
						`/item/${key}`,
					)) as ItemGetResponse;

					return [key, response.item] as const;
				}),
			);

			return Object.fromEntries(
				loaded.filter(([, item]) => item),
			) as Record<string, BucketPublication>;
		},
		{ keepPreviousData: true, revalidateOnFocus: false },
	);

	if (!data) return { ...NO_PUBLICATIONS, isLoading };

	return {
		byKey: data,
		isLoading,
		pdfSources: Object.assign(
			{},
			...keys.map((key) =>
				publicationPdfCitationSources(key, data[key]?.attachmentsData),
			),
		) as Record<string, string>,
	};
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
