"use client";

import { Session } from "next-auth";
import { useMemo, useRef, useState } from "react";
import { COLLECTION_PER_PAGE } from "@/constants/user";
import { twMerge } from "tailwind-merge";
import { Pagination } from "@/components/nextui/Pagination";
import { Input } from "@/components/nextui/Input";
import { InferSelectModel } from "drizzle-orm";
import { userCollection } from "@/db/schema/tables/userCollection";
import UserCollection from "./UserCollection";


export default function CollectionsList({ data, highlightedCollections, classNames, onCollectionSelect, isLoading }: { data: Session["user"], highlightedCollections?: string[], classNames?: { container?: string, pagination?: string }, onCollectionSelect?: (collectionId: string) => void, isLoading?: boolean	 }) {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");
	const [collectionsPage, totalPages, currentPage] = useMemo(() => {
		const sortedCollections = data.collections.sort((a, b) => {
			const aItems = a.numItems || 0;
			const bItems = b.numItems || 0;
			if (aItems !== bItems) {
				return bItems - aItems;
			}
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});
		const filteredCollections = sortedCollections.filter((collection) => {
			return collection.name.toLowerCase().includes(search.toLowerCase()) || collection.description?.toLowerCase().includes(search.toLowerCase());
		});
		const totalPages = Math.ceil(filteredCollections.length / COLLECTION_PER_PAGE);
		const currentPage = page <= totalPages ? page : totalPages;
		return [
			filteredCollections.slice(
				(currentPage - 1) * COLLECTION_PER_PAGE,
				currentPage * COLLECTION_PER_PAGE
			),
			totalPages,
			currentPage,
		];
	}, [data.collections, page, search]);

	return (
		<>
			<Input placeholder="Search" onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} />
			<div className={twMerge("w-full grid grid-cols-2 gap-2", classNames?.container)}>
				{collectionsPage.map((collection: any, index: number) => (
					<UserCollection isLoading={isLoading} isHighlighted={highlightedCollections?.includes(collection.id)} onClick={() => onCollectionSelect?.(collection.id)} key={index} collection={collection} />
				))}
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
