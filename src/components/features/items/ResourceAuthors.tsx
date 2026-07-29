import { Item, ListItem } from "@/app/api/item/types";
import ResourceData from "./ResourceData";
import { useTranslations } from "next-intl";
import { Author } from "@/app/api/item/types";
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
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
	
	const firstAuthor = authors.find(author => author.lastName);
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
			(configuredInstitution || authorText) && <span className="max-w-80 truncate overflow-hidden flex items-center gap-2">
				{configuredInstitution?.logoUrl && (
					<RuntimeAsset
						reference={configuredInstitution.logoUrl}
						alt={t("institutionLogoAlt", {
							name: configuredInstitution.name,
						})}
						className="size-6 shrink-0 rounded-md bg-white/80 object-contain p-0.5"
					/>
				)}
				{authorText}
			</span>
		);
	}

	return null;
}
