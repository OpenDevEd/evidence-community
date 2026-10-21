import { Item, ListItem } from "@/app/api/item/types";
import ResourceData from "./ResourceData";
import { useTranslations } from "next-intl";
import { Author } from "@/app/api/item/types";
import { InstitutionLogo } from "@/components/library/LibraryIdentity";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

function toInitials(name?: string) {
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
	
	const firstAuthor = authors.find(author => author.lastName || author.name);
	if (!firstAuthor) return '';
	return authorString(firstAuthor) + " " + t("etAl");
}

export default function ResourceAuthors({
	itemData,
}: {
	itemData: Item | ListItem | undefined;
}) {
	const t = useTranslations("ui");
	const { institutions: configuredInstitutions } = useLibraryConfig();

	const configuredInstitution = findInstitutionWithLogo(
		configuredInstitutions,
		itemData?.institution,
	);

	if (itemData && itemData.creators && itemData.creators.length > 0) {
		const authorText = formatAPAAuthor(itemData?.creators as Author[], t);

		return (
			(configuredInstitution || authorText) && <span className="flex min-w-0 max-w-80 items-center gap-2">
				{configuredInstitution?.logoUrl && (
					<InstitutionLogo
						alt={t("institutionLogoAlt", {
							name: configuredInstitution.name,
						})}
						logoUrl={configuredInstitution.logoUrl}
					/>
				)}
				{/* The names themselves are cut with an ellipsis: a flex row clips its text without one. */}
				<span className="truncate">{authorText}</span>
			</span>
		);
	}

	return null;
}
