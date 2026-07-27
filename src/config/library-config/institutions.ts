import type { LibraryPublicConfig } from "./schema";

export type RuntimeInstitution =
	LibraryPublicConfig["institutions"][number];

function normalizeInstitutionName(name: string): string {
	return name.trim().toLocaleLowerCase("en");
}

export function findInstitutionWithLogo(
	configuredInstitutions: readonly RuntimeInstitution[],
	itemInstitutions: string | readonly string[] | null | undefined,
): RuntimeInstitution | undefined {
	const names =
		typeof itemInstitutions === "string"
			? [itemInstitutions]
			: itemInstitutions ?? [];
	const institutionsByName = new Map(
		configuredInstitutions
			.filter(
				(
					institution,
				): institution is RuntimeInstitution & { logoUrl: string } =>
					Boolean(institution.logoUrl),
			)
			.map((institution) => [
				normalizeInstitutionName(institution.name),
				institution,
			]),
	);

	for (const name of names) {
		const institution = institutionsByName.get(
			normalizeInstitutionName(name),
		);
		if (institution) return institution;
	}

	return undefined;
}
