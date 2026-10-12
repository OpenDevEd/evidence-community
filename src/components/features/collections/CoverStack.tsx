"use client";

import useSWR from "swr";

import type { ItemsGetResponse } from "@/app/api/items/types";
import { PdfCover } from "@/components/features/items/PdfCover";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";

/** A reader's bookmarks, or one of their collections, as the library lists records: the first page. */
export function useShelfItems(userId: string, collectionId: string) {
	const query = buildItemsQuery(collectionId ? { collectionId, page: 1 } : { page: 1 }, `/user/items/${userId}`);
	return useSWR<ItemsGetResponse>(query, fetcher, { revalidateOnFocus: false, keepPreviousData: true });
}

/** Where each of the three covers sits, closed and fanned out: [x in px, rotation in degrees], at the medium size. */
const STACK_POSES = [
	{ closed: [0, 0], fanned: [0, 0] },
	{ closed: [-12, -8], fanned: [-22, -14] },
	{ closed: [12, 8], fanned: [22, 14] },
] as const;

/** The stack's box, one cover's width (and the offset that centres it), and how far the poses spread, by size. */
const SIZES = {
	md: { box: "h-[4.5rem] w-24", cover: "-ms-6 w-12", width: 48, spread: 1 },
	sm: { box: "h-[3.25rem] w-[4.5rem]", cover: "-ms-[1.125rem] w-9", width: 36, spread: 0.75 },
} as const;

/**
 * A collection's first three records as a little stack of cover pages, the
 * first in front. A chosen collection fans its stack out. An empty one shows
 * an outline where its first record will go. The box has a fixed size, so the
 * covers arriving moves nothing, and each fades in over its placeholder.
 */
export function CoverStack({
	userId,
	collectionId,
	count,
	fanned,
	size = "md",
}: {
	userId: string;
	collectionId: string;
	count: number;
	fanned: boolean;
	size?: keyof typeof SIZES;
}) {
	const { data } = useShelfItems(userId, collectionId);
	const records = data?.items.slice(0, 3) ?? [];
	const slots = Math.min(count, 3);
	const shape = SIZES[size];
	return (
		<span aria-hidden className={twMerge("relative block shrink-0", shape.box)}>
			{count === 0 ? (
				<span className={twMerge("absolute start-1/2 top-1 aspect-[3/4] -translate-x-1/2 rounded-md border-2 border-dashed border-black/15 rtl:translate-x-1/2 dark:border-white/20", size === "sm" ? "w-9" : "w-12")} />
			) : (
				Array.from({ length: slots }, (_, index) => slots - 1 - index).map((index) => {
					const record = records[index];
					const [x, rotation] = STACK_POSES[index]![fanned ? "fanned" : "closed"];
					return (
						<span
							key={index}
							className={twMerge(
								"absolute start-1/2 top-1 transition-transform duration-300 ease-out group-hover:[--lift:-2px] motion-reduce:transition-none",
								shape.cover,
							)}
							style={{ transform: `translate(${x * shape.spread}px, var(--lift, 0px)) rotate(${rotation}deg)` }}
						>
							<span className="block aspect-[3/4] w-full rounded-md bg-black/[0.08] dark:bg-white/10" />
							{record ? (
								<span className="absolute inset-0 animate-fade-in motion-reduce:animate-none">
									<PdfCover
										src={record.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage}
										alt=""
										title={record.title ?? undefined}
										className="aspect-[3/4] w-full rounded-md object-cover shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
										width={shape.width}
									/>
								</span>
							) : null}
						</span>
					);
				})
			)}
		</span>
	);
}
