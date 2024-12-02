import { Collection } from "@/app/api/collections/types";
import { Checkbox } from "@/components/nextui/Checkbox";

export default function CollectionHierarchy({
	collectionData,
	collections,
	selectedCollections,
	onCheckboxChange,
}: {
	collectionData: Collection;
	collections: Collection[];
	selectedCollections: string[];
	onCheckboxChange: (key: string) => void;
}) {
	const children = collectionData.children || [];
	const level = collectionData.level || 0;
	const isSelected = selectedCollections.includes(collectionData.key);

	return (
		<>
			{collectionData.level !== 0 && (
				<Checkbox
					size={collectionData.level !== 1 ? "lg" : undefined}
					isSelected={isSelected}
					onValueChange={() => onCheckboxChange(collectionData.key)}
					style={{ marginLeft: `${(level - 1) * 16}px` }}
				>
					{collectionData.name} ({collectionData.numItems})
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
					/>
				))}
		</>
	);
}
