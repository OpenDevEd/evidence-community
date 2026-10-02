import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Collection } from "@/app/api/collections/types";
import { Checkbox } from "@/components/nextui/Checkbox";
import { FacetDistribution } from "meilisearch";
import { useMemo, memo } from "react";
import { useFormatter } from "next-intl";
import { barWidth, shareOf } from "./ResultsOverview";
interface CollectionHierarchyProps {
	collectionData: Collection;
	collections: Collection[];
	selectedCollections: string[];
	onCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
	/** How many results there are, for each row's share of them. */
	total?: number;
	/** The largest count among this row and its siblings, which its bar is measured against. */
	largest?: number;
}

function hasSelectedDescendant(
	collection: Collection,
	selectedCollections: ReadonlySet<string>,
): boolean {
	return (
		selectedCollections.has(collection.key) ||
		(collection.children ?? []).some((child) =>
			hasSelectedDescendant(child, selectedCollections),
		)
	);
}

function CollectionHierarchy({
	collectionData,
	collections,
	selectedCollections,
	onCheckboxChange,
	facetDistribution,
	total,
	largest = 1,
}: CollectionHierarchyProps) {
	const format = useFormatter();
	const level = collectionData.level || 0;
	const isSelected = selectedCollections.includes(collectionData.key);
	
	// Memoize the show logic (keep original logic)
	const show = useMemo(() => {
		return isSelected ||
			(collectionData.level !== 0 &&
				facetDistribution?.collectionsAncestry[collectionData.key] &&
				facetDistribution?.collectionsAncestry[collectionData.key] > 0);
	}, [isSelected, collectionData.level, collectionData.key, facetDistribution?.collectionsAncestry]);

	// Memoize sorted children
	const children = useMemo(() => {
		const childrenUnsorted = collectionData.children || [];
		if (childrenUnsorted.length === 0) return [];
		
		const newArray = [...childrenUnsorted];
		return newArray.sort((a: Collection, b: Collection) =>
			(a.name || "").localeCompare(b.name || "")
		);
	}, [collectionData.children]);

	const hasChildren = children.length > 0;
	const countOf = (key: string) => facetDistribution?.collectionsAncestry[key] || 0;
	const childLargest = Math.max(1, ...children.map((child) => countOf(child.key)));

	// Memoize the descendant selection check
	const isDescendantSelected = useMemo(() => {
		// Early return for performance - if no children, no descendants can be selected
		if (!hasChildren) return false;
		return hasSelectedDescendant(
			collectionData,
			new Set(selectedCollections),
		);
	}, [collectionData, hasChildren, selectedCollections]);

	// Memoize the style object to prevent unnecessary re-renders
	const checkboxStyle = useMemo(() => ({
		marginLeft: `${(level - 1) * 16}px`
	}), [level]);

	// Memoize the size prop
	const checkboxSize = useMemo(() => 
		collectionData.parentCollection === collectionData.originalFacet ? "lg" : undefined,
		[collectionData.parentCollection, collectionData.originalFacet]
	);

	// Memoize the count for display (keep original logic)
	const count = useMemo(() => {
		return facetDistribution?.collectionsAncestry[collectionData.key] || 0;
	}, [facetDistribution?.collectionsAncestry, collectionData.key]);



	return (
		<>
			{show && (
				<Checkbox
					size={checkboxSize}
					isSelected={isSelected}
					onValueChange={() => onCheckboxChange(collectionData.key)}
					style={checkboxStyle}
					className="collection"
					classNames={{
						base: "w-full max-w-full",
						label: "min-w-0 flex-1 text-black/60 dark:text-white/60",
					}}
				>
					<span className="flex w-full min-w-0 flex-col gap-1.5">
						<span className="flex min-w-0 items-baseline gap-2">
							<span className="min-w-0 flex-1">
								{collectionData.name}
								{hasChildren && (
									<span className="dark:opacity-75 ltr:ml-2 rtl:mr-2 inline-block translate-y-0.5">
										<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
									</span>
								)}
							</span>
							{total ? <span className="shrink-0 text-xs tabular-nums">{shareOf(format, count, total)}</span> : null}
							<span className="min-w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-black dark:text-white">{format.number(count)}</span>
						</span>
						<span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-accent/10">
							<span className="block h-full rounded-full bg-accent/70" style={{ width: barWidth(count, largest) }} />
						</span>
					</span>
				</Checkbox>
			)}
			{(isSelected || isDescendantSelected || level === 0) &&
				children.map((child) => (
					<CollectionHierarchy
						key={child.key}
						collectionData={child}
						collections={collections}
						selectedCollections={selectedCollections}
						onCheckboxChange={onCheckboxChange}
						facetDistribution={facetDistribution}
						total={total}
						largest={childLargest}
					/>
				))}
		</>
	);
}

// Memoize the component to prevent unnecessary re-renders
export default memo(CollectionHierarchy);
