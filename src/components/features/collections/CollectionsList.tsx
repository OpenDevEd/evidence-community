"use client";

import { Accordion, AccordionItem } from "@nextui-org/react";
import { useParamsState } from "@/hooks/useParamsState";
import { Skeleton } from "../../nextui/Skeleton";
import { GrConfigure } from "react-icons/gr";
import { useHierarchy } from "@/hooks/useHierarchy";
import { twMerge } from "tailwind-merge";
import CollectionCategory from "./CollectionCategory";
import { CollectionsGetResponse } from "@/app/api/collections/types";

export default function CollectionsList({
	data,
	handleCheckboxChange,
	selectedCollections,
	hierarchy,
	isModal = false,
}: {
	data: CollectionsGetResponse | undefined;
	handleCheckboxChange: (key: string) => void;
	selectedCollections: string[];
	isModal?: boolean;
} & ReturnType<typeof useHierarchy>) {
	const { searchParams, router, pathname, createQueryString } =
		useParamsState();

	return (
		<div
			className={twMerge(
				"w-full xl:w-[456px] shrink-0",
				isModal ? "block" : "hidden xl:block"
			)}
		>
			<Skeleton
				className="w-full xl:min-h-screen rounded-2xl"
				isLoaded={!!data}
			>
				{hierarchy && hierarchy.length > 0 ? (
					<Accordion
						defaultExpandedKeys={hierarchy.map((c) => c.key)}
						selectionMode="multiple"
						fullWidth={false}
						variant="shadow"
						className="bg-white dark:bg-card p-6 rounded-xl shadow-none"
						itemClasses={{
							title: "text-black/80 dark:text-white/80 font-base text-2xl",
							indicator: "text-black/80 dark:text-white/80",
							trigger: "p-0",
							base: "mb-4 last:mb-0",
							content: "pt-4",
						}}
						showDivider={false}
					>
						{hierarchy
							.filter((c) => c.numCollections && c.numCollections > 0)
							.map((collection) => (
								<AccordionItem
									key={collection.key}
								title={collection.title || collection.name}
							>
								<CollectionCategory
									collection={collection}
									hierarchy={hierarchy}
									selectedCollections={selectedCollections}
									handleCheckboxChange={handleCheckboxChange}
								/>
							</AccordionItem>
						))}
					</Accordion>
				) : (
					<div className="text-lg bg-white dark:bg-card p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 xl:h-screen select-none">
						<GrConfigure className="stroke-current size-6" />
						<span>No facets configured.</span>
					</div>
				)}
			</Skeleton>
		</div>
	);
}
