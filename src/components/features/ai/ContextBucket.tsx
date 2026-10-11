"use client";

import {
	AuthorProfilesContext,
	useAuthorProfiles,
} from "@/lib/authors/use-author-profiles";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import useSWR from "swr";

import type { ItemsBatchResponse } from "@/app/api/items/batch/route";
import type { ListItem } from "@/app/api/item/types";
import Resource from "@/components/features/items/Resource";
import type { BucketEntry } from "@/context/InlineChatLayout";
import { BUCKET_PAGE_SIZE, loadBucketPages } from "@/lib/ai/context-bucket";
import { bucketPdfCitationSources } from "@/lib/ai/citations";
import { fetcherPOST } from "@/lib/utils";

export type BucketPublication = ListItem;
export type BucketPublications = {
	byKey: Record<string, BucketPublication>;
	isLoading: boolean;
	/** Where the cited PDF pages live, for every publication loaded so far. */
	pdfSources: Record<string, string>;
};

/** Asks the library for one page of the publications a chat has used. */
async function loadBucketPage(keys: string[], page: number) {
	const answer = (await fetcherPOST([
		"/items/batch",
		{ keys, page, perPage: BUCKET_PAGE_SIZE, includeHeavyFields: true },
		undefined,
	])) as ItemsBatchResponse;

	return { items: answer.items, totalPages: answer.totalPages };
}

/**
 * The publications the assistant has used, loaded together rather than one at
 * a time. Long conversations are loaded a page at a time until they are all
 * in, so none is quietly left out.
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
	// The order the chat shows them in, kept as one value so the work below is
	// only done again when the list itself changes.
	const shownOrder = entries.map((entry) => entry.key).join(" ");
	// Page citations open only PDFs the assistant read: a search hit or a link it wrote does not count.
	const readOrder = entries.filter((entry) => entry.source === "read").map((entry) => entry.key).join(" ");
	const wanted = [...new Set(entries.map((entry) => entry.key))].sort();
	const { data: items, isLoading } = useSWR<ListItem[]>(
		wanted.length > 0 ? ["/items/batch", { keys: wanted }] : null,
		([, request]: [string, { keys: string[] }]) =>
			loadBucketPages(request.keys.length, (page) =>
				loadBucketPage(request.keys, page),
			),
		{
			keepPreviousData: true,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			// One failure is reported to the reader instead of being retried
			// behind their back for as long as the chat is open.
			shouldRetryOnError: false,
		},
	);

	return useMemo(() => {
		const byKey: Record<string, BucketPublication> = {};
		const attachmentsByKey: Record<
			string,
			BucketPublication["attachmentsData"]
		> = {};
		for (const item of items ?? []) {
			if (!item.key) continue;
			byKey[item.key] = item;
			attachmentsByKey[item.key] = item.attachmentsData;
		}

		return {
			byKey,
			isLoading,
			pdfSources: bucketPdfCitationSources(
				readOrder ? readOrder.split(" ") : [],
				attachmentsByKey,
			),
		};
	}, [isLoading, items, readOrder]);
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
			openLinksInNewTab
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
	const { profiles } = useAuthorProfiles(
		Object.values(publications.byKey)?.flatMap(
			(item) => item.creators ?? [],
		),
	);
	return (
		<AuthorProfilesContext value={profiles}>
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
								isLoading={
									publications.byKey[entry.key] ===
										undefined && publications.isLoading
								}
							/>
						</motion.div>
					))}
				</AnimatePresence>
			</div>
		</AuthorProfilesContext>
	);
}
