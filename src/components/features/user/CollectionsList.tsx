"use client";

import { useMemo, useRef, useState } from "react";
import { COLLECTION_PER_PAGE } from "@/constants/user";
import { twMerge } from "@/lib/tw-merge";
import { Pagination } from "@/components/nextui/Pagination";
import { Input } from "@/components/nextui/Input";
import type { ReaderCollectionSummary } from "@/lib/readers/data";
import UserCollection from "./UserCollection";
import { useTranslations } from "next-intl";

export default function CollectionsList({
	collections,
	highlightedCollections,
	classNames,
	onCollectionSelect,
	isLoading,
}: {
	collections: ReaderCollectionSummary[];
	highlightedCollections?: string[];
	classNames?: { container?: string; pagination?: string };
	onCollectionSelect?: (collectionId: string) => void;
	isLoading?: boolean;
}) {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");
	const t = useTranslations("ui");
	const [collectionsPage, totalPages, currentPage] = useMemo(() => {
		// The reader's own come first, then the ones shared with them that they edit.
		const sortedCollections = [...collections].sort((a, b) => {
			const aShared = "owner" in a;
			if (aShared !== "owner" in b) return aShared ? 1 : -1;
			// const aHighlighted = highlightedCollections?.includes(a.id) || false;
			// const bHighlighted = highlightedCollections?.includes(b.id) || false;
			// if (aHighlighted !== bHighlighted) {
			// 	return bHighlighted ? 1 : -1;
			// }
			// const aItems = a.numItems || 0;
			// const bItems = b.numItems || 0;
			// if (aItems !== bItems) {
			// 	return bItems - aItems;
			// }
			return (
				new Date(b.createdAt).getTime() -
				new Date(a.createdAt).getTime()
			);
		});
		const filteredCollections = sortedCollections.filter((collection) => {
			return (
				collection.name.toLowerCase().includes(search.toLowerCase()) ||
				collection.description
					?.toLowerCase()
					.includes(search.toLowerCase())
			);
		});
		const totalPages = Math.ceil(
			filteredCollections.length / COLLECTION_PER_PAGE
		);
		const currentPage = page <= totalPages ? page : totalPages;
		return [
			filteredCollections.slice(
				(currentPage - 1) * COLLECTION_PER_PAGE,
				currentPage * COLLECTION_PER_PAGE
			),
			totalPages,
			currentPage,
		];
	}, [collections, page, search]);

	return (
		<>
			<Input
				placeholder={t("searchCollections")}
				onChange={(e) => setSearch(e.target.value)}
				onClear={() => setSearch("")}
			/>
			<div
				className={twMerge(
					"w-full grid grid-cols-2 gap-2",
					collections.length === 0 && "grid-cols-1",
					classNames?.container
				)}
			>
				{collections.length === 0 ? (
					<div className="w-full flex justify-center items-center my-12">
						<p className="text-sm dark:text-white/60 text-black/60">
							{t("noCollections")}
						</p>
					</div>
				) : (
					collectionsPage.map((collection: any, index: number) => (
						<UserCollection
							isLoading={isLoading}
							isHighlighted={highlightedCollections?.includes(
								collection.id
							)}
							onPress={() => onCollectionSelect?.(collection.id)}
							key={index}
							collection={collection}
						/>
					))
				)}
			</div>
			<div
				className={twMerge(
					"w-full flex justify-center",
					totalPages <= 1 && "hidden",
					classNames?.pagination
				)}
			>
				<Pagination
					total={totalPages}
					page={currentPage}
					siblings={0}
					onChange={setPage}
				/>
			</div>
		</>
	);
}
