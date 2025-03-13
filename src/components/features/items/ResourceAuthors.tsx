import { Item } from "@/app/api/item/types";
import { INSTITUTION_LOGOS } from "@/constants/items";
import ResourceData from "./ResourceData";
import { useTranslations } from "next-intl";

export type Author = {
	firstName: string;
	lastName: string;
	institution: string;
	name: string;
};

function toInitials(name: string) {
	if (!name) return '';
	return name.split(' ').map(n => n[0]).join('. ') + ".";
}

function formatAPAAuthor(authors: Author[], t: ReturnType<typeof useTranslations>) {
	function authorString(author: Author) {
		if (author.name) return author.name;
		return [author.lastName, toInitials(author.firstName)].filter(Boolean).join(", ")
	}

	if (!authors || authors.length === 0) return '';
	
	if (authors.length <= 2) {
		return authors
			.map(authorString)
			.join(' & ');
	}
	
	const firstAuthor = authors.find(author => author.lastName);
	if (!firstAuthor) return '';
	return authorString(firstAuthor) + " " + t("etAl");
}

export default function ResourceAuthors({
	itemData,
}: {
	itemData: Item | undefined;
}) {
	const t = useTranslations("ui");

	if (itemData?.institution) {
		// Handle both string and array cases for institution
		const institutions = Array.isArray(itemData.institution) 
			? itemData.institution 
			: [itemData.institution];
		
		if (institutions.length) {
			// Find the first institution that has a matching logo

			const institutionWithLogo = institutions.find(institution => 
				Object.keys(INSTITUTION_LOGOS).some(key => institution.includes(key))
			);
			
			// Use the institution with logo if found, otherwise use the first institution
			const selectedInstitution = institutionWithLogo || institutions[0];
			
			const InstitutionLogo = Object.entries(INSTITUTION_LOGOS).find(
				([key]) => selectedInstitution.includes(key)
			)?.[1];

			// return (
			// 	<ResourceData
			// 		startContent={InstitutionLogo ? <InstitutionLogo /> : null}
			// 		text={selectedInstitution} />
			// );
		}
	}

	if (itemData && itemData.creators && itemData.creators.length > 0)
		return (
			<span className="max-w-64 truncate overflow-hidden">
				{formatAPAAuthor(itemData?.creators as Author[], t)}
			</span>
		);

	return null;
}
