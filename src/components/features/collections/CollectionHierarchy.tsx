import { Collection } from "@/app/api/collections/types";
import { Checkbox } from "@/components/nextui/Checkbox";
import { FacetDistribution } from "meilisearch";

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
	const children = collectionData.children || [];
	const level = collectionData.level || 0;
	const isSelected = selectedCollections.includes(collectionData.key);
	const show =
		isSelected ||
		(collectionData.level !== 0 &&
			facetDistribution?.collectionsAncestry[collectionData.key] &&
			facetDistribution?.collectionsAncestry[collectionData.key] > 0);

	return (
		<>
			{show && (
				<Checkbox
					size={collectionData.level !== 1 ? "lg" : undefined}
					isSelected={isSelected}
					onValueChange={() => onCheckboxChange(collectionData.key)}
					style={{ marginLeft: `${(level - 1) * 16}px` }}
					className="collection"
				>
					{collectionData.name}
					{!isSelected && (
						<span className="opacity-75 ltr:ml-1 rtl:mr-1">
							(
							{facetDistribution?.collectionsAncestry[
								collectionData.key
							] || 0}
							)
						</span>
					)}
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
