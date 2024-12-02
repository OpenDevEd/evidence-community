import { Item } from "@/app/api/item/types";
import { INSTITUTION_LOGOS } from "@/constants/items";
import ResourceData from "./ResourceData";

export default function ResourceAuthors({
	itemData,
}: {
	itemData: Item | undefined;
}) {
	if (itemData?.institution) {
		const institutionLogo = Object.entries(INSTITUTION_LOGOS).find(
			([key]) => itemData.institution?.includes(key)
		)?.[1];

		return (
			<ResourceData
				startContent={institutionLogo}
				text={itemData?.institution} />
		);
	}

	if (itemData && itemData.creators && itemData.creators.length > 0)
		return (
			<div className="max-w-64 truncate overflow-hidden">
				{itemData?.creators
					?.map((creator: any) => creator.firstName
						? `${creator.firstName}, ${creator.lastName}`
						: creator.name || null
					)
					.join(", ")}
			</div>
		);

	return null;
}
