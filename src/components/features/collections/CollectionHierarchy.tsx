import { Collection } from "@/app/api/collections/types";
import { Checkbox } from "@/components/nextui/Checkbox";
import { FacetDistribution } from "meilisearch";
import { useMemo, useCallback, memo } from "react";
import { IoIosArrowDown } from "react-icons/io";

interface CollectionHierarchyProps {
	collectionData: Collection;
	collections: Collection[];
	selectedCollections: string[];
	onCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
}

function CollectionHierarchy({
	collectionData,
	collections,
	selectedCollections,
	onCheckboxChange,
	facetDistribution,
}: CollectionHierarchyProps) {
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

	// Memoize the recursive function to avoid recreating it on every render
	const isDescendantSelectedRecursive = useCallback((collection: Collection): boolean => {
		if (selectedCollections.includes(collection.key)) {
			return true;
		}
		const collectionChildren = collection.children || [];
		return collectionChildren.some(isDescendantSelectedRecursive);
	}, [selectedCollections]);

	// Memoize the descendant selection check
	const isDescendantSelected = useMemo(() => {
		// Early return for performance - if no children, no descendants can be selected
		if (!hasChildren) return false;
		return isDescendantSelectedRecursive(collectionData);
	}, [hasChildren, isDescendantSelectedRecursive, collectionData]);

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
						label: "text-black/60 dark:text-white/60",
					}}
				>
					<div className="">
						{collectionData.name}
						{!isSelected && (
							<span className="dark:opacity-75 ltr:ml-1 rtl:mr-1">
								({count})
							</span>
						)}
						{hasChildren && (
							<div className="dark:opacity-75 ltr:ml-2 rtl:mr-2 inline-block translate-y-0.5">
								<IoIosArrowDown className="size-4" />
							</div>
						)}
					</div>
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
					/>
				))}
		</>
	);
}

// Memoize the component to prevent unnecessary re-renders
export default memo(CollectionHierarchy);
