"use client";

import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "../../nextui/Button";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import { LuChevronDown } from "react-icons/lu";
import { Collection } from "@/app/api/collections/types";
import { MAX_COLLAPSED_HEIGHT } from "@/constants/collections";
import CollectionHierarchy from "./CollectionHierarchy";

export default function CollectionCategory({
	collection,
	hierarchy,
	selectedCollections,
	handleCheckboxChange,
}: {
	collection: Collection;
	hierarchy: Collection[];
	selectedCollections: string[];
	handleCheckboxChange: (key: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const [showMore, setShowMore] = useState(false);
	const previousShowMore = useRef(showMore);

	useEffect(() => {
		const apply = () => {
			if (ref.current) {
				setShowMore((prev) => {
					previousShowMore.current = prev;
					if (!ref.current) return prev;
					return ref.current.scrollHeight > MAX_COLLAPSED_HEIGHT;
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
	}, [ref]);

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
					"flex flex-col gap-4 overflow-hidden transition-all duration-200 pb-0"
				)}
				ref={ref}
			>
				<CollectionHierarchy
					collectionData={collection}
					collections={hierarchy}
					selectedCollections={selectedCollections}
					onCheckboxChange={handleCheckboxChange}
				/>
			</div>
			<div
				className={twMerge(
					"transition-all duration-200 pb-0",
					expanded && showMore && "pb-16"
				)}
			></div>
			<AnimatePresence mode="wait">
				{showMore && (
					<motion.div
						initial={
							previousShowMore.current == false
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
							{expanded ? "See Less" : "See More"}
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
