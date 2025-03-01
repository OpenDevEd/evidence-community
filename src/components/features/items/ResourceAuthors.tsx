import { Item } from "@/app/api/item/types";
import { INSTITUTION_LOGOS } from "@/constants/items";
import ResourceData from "./ResourceData";

export default function ResourceAuthors({
	itemData,
}: {
	itemData: Item | undefined;
}) {
	if (itemData?.institution) {
		// Handle both string and array cases for institution
		const institutions = Array.isArray(itemData.institution) 
			? itemData.institution 
			: [itemData.institution];
		
		if (institutions.length) {
			// Find the first institution that has a matching logo
			console.log("INSTITUTION", institutions);

			const institutionWithLogo = institutions.find(institution => 
				Object.keys(INSTITUTION_LOGOS).some(key => institution.includes(key))
			);
			
			// Use the institution with logo if found, otherwise use the first institution
			const selectedInstitution = institutionWithLogo || institutions[0];
			
			const InstitutionLogo = Object.entries(INSTITUTION_LOGOS).find(
				([key]) => selectedInstitution.includes(key)
			)?.[1];

			return (
				<ResourceData
					startContent={InstitutionLogo ? <InstitutionLogo /> : null}
					text={selectedInstitution} />
			);
		}
	}

	if (itemData && itemData.creators && itemData.creators.length > 0)
		return (
			<span className="max-w-64 truncate overflow-hidden">
				{itemData?.creators
					?.map((creator: any) => (creator.firstName || creator.lastName)
						? [creator.firstName, creator.lastName].filter(Boolean).join(" ")
						: creator.name || null
					)
					.join(", ")}
			</span>
		);

	return null;
}
