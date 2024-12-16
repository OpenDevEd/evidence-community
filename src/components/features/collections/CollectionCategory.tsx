"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "../../nextui/Button";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import { LuChevronDown } from "react-icons/lu";
import { Collection } from "@/app/api/collections/types";
import { MAX_COLLAPSED_HEIGHT } from "@/constants/collections";
import CollectionHierarchy from "./CollectionHierarchy";
import { FacetDistribution } from "meilisearch";
import { useTranslations } from "next-intl";
import { CacheContext } from "@/context/Providers";

export default function CollectionCategory({
	collection,
	hierarchy,
	selectedCollections,
	handleCheckboxChange,
	facetDistribution,
}: {
	collection: Collection;
	hierarchy: Collection[];
	selectedCollections: string[];
	handleCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
}) {
	const t = useTranslations("ui");
	const [expanded, setExpanded] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const [showMore, setShowMore] = useState(false);
	const { previousExpansionStates } = useContext(CacheContext);

	useEffect(() => {
		const apply = () => {
			if (ref.current) {
				setShowMore((prev) => {
					if (!ref.current) return prev;
					previousExpansionStates.current[collection.key] = ref.current.scrollHeight > (MAX_COLLAPSED_HEIGHT - 200);
					return previousExpansionStates.current[collection.key];
				});
			}
		};

		const observer = new MutationObserver(apply);
		if (ref.current) {
			observer.observe(ref.current, { childList: true, subtree: true });
		}
		apply();
		return () => {
			observer.disconnect();
		};
	}, [ref, collection.key, previousExpansionStates.current]);

	if (previousExpansionStates.current[collection.key] === undefined) {
		previousExpansionStates.current[collection.key] = showMore;
	}

	if (collection.key === "HCTKHFNN") {
		console.log(previousExpansionStates.current[collection.key]);
	}

	return (
		<div className="relative">
			<div
				style={{
					maxHeight: expanded
						? `${
								(ref.current?.scrollHeight ??
									MAX_COLLAPSED_HEIGHT) + 200
						  }px`
						: `${MAX_COLLAPSED_HEIGHT}px`,
				}}
				className={twMerge(
					"flex flex-col gap-4 overflow-hidden transition-all duration-200 pb-0 py-2"
				)}
				ref={ref}
			>
				<CollectionHierarchy
					collectionData={collection}
					collections={hierarchy}
					selectedCollections={selectedCollections}
					onCheckboxChange={handleCheckboxChange}
					facetDistribution={facetDistribution}
				/>
			</div>
			<div
				className={twMerge(
					"transition-all duration-200 pb-0",
					expanded && showMore && "pb-14"
				)}
			></div>
			<AnimatePresence mode="wait" initial={false}>
				{showMore && (
					<motion.div
						initial={
							previousExpansionStates.current[collection.key] !== showMore
								? { opacity: 0 }
								: { opacity: 1 }
						}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className={twMerge(
							"absolute bottom-0 w-full bg-white dark:bg-card z-10",
							"before:absolute before:-top-24 before:left-0 before:right-0 before:h-24 before:bg-gradient-to-t from-white dark:before:from-card before:to-transparent before:z-10 before:opacity-100 before:transition-opacity duration-400 before:pointer-events-none",
							expanded && "before:opacity-0"
						)}
						key={"show-more"}
					>
						<Button
							className="w-full"
							endContent={
								<LuChevronDown
									className={twMerge(
										expanded && "rotate-180"
									)}
								/>
							}
							onPress={() => setExpanded(!expanded)}
						>
							{expanded ? t("seeLess") : t("seeMore")}
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
