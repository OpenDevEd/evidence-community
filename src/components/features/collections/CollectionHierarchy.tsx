import { Collection } from "@/app/api/collections/types";
import { Checkbox } from "@/components/nextui/Checkbox";
import { FacetDistribution } from "meilisearch";
import { useMemo } from "react";
import { IoIosArrowDown } from "react-icons/io";

export default function CollectionHierarchy({
	collectionData,
	collections,
	selectedCollections,
	onCheckboxChange,
	facetDistribution,
}: {
	collectionData: Collection;
	collections: Collection[];
	selectedCollections: string[];
	onCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
}) {
	const childrenUnsorted = collectionData.children || [];
	const children = useMemo(() => {
		return childrenUnsorted.toSorted((a: Collection, b: Collection) =>
			(a.name || "").localeCompare(b.name || "")
		);
	}, [childrenUnsorted]);
	const level = collectionData.level || 0;
	const isSelected = selectedCollections.includes(collectionData.key);
	const show =
		isSelected ||
		(collectionData.level !== 0 &&
			facetDistribution?.collectionsAncestry[collectionData.key] &&
			facetDistribution?.collectionsAncestry[collectionData.key] > 0);
	const hasChildren = children.length > 0;

	return (
		<>
			{show && (
				<Checkbox
					size={collectionData.level !== 1 ? "lg" : undefined}
					isSelected={isSelected}
					onValueChange={() => onCheckboxChange(collectionData.key)}
					style={{ marginLeft: `${(level - 1) * 16}px` }}
					className="collection"
					classNames={{
						label: "text-black/60 dark:text-white/60",
					}}
				>
					<div className="">
						{collectionData.name}
						{!isSelected && (
							<span className="dark:opacity-75 ltr:ml-1 rtl:mr-1">
								(
								{facetDistribution?.collectionsAncestry[
									collectionData.key
								] || 0}
								)
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
			{(isSelected || level === 0) &&
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
