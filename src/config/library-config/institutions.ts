import type { LibraryPublicConfig } from "./schema";

export type RuntimeInstitution = LibraryPublicConfig["institutions"][number];

/** Two spellings with the same key are the same institution. */
export function institutionNameKey(name: string): string {
	return name.normalize("NFC").trim().toLocaleLowerCase("en");
}

/** Zotero stores this list in one pipe-separated institution/university field. */
export function parseInstitutionNames(value: string): string[] {
	const names = new Map<string, string>();
	for (const entry of value.split("|")) {
		const name = entry.trim();
		const key = institutionNameKey(name);
		if (name && !names.has(key)) names.set(key, name);
	}
	return [...names.values()];
}

export function formatInstitutionNames(names: readonly string[]): string {
	return parseInstitutionNames(names.join("|")).join(" | ");
}

export function hasInstitution(
	institutions: readonly string[],
	name: string,
): boolean {
	const normalizedName = institutionNameKey(name);
	return institutions.some(
		(institution) =>
			institutionNameKey(institution) === normalizedName,
	);
}

export function findInstitutionWithLogo(
	configuredInstitutions: readonly RuntimeInstitution[],
	itemInstitutions: string | readonly string[] | null | undefined,
): RuntimeInstitution | undefined {
	const names =
		typeof itemInstitutions === "string"
			? [itemInstitutions]
			: (itemInstitutions ?? []);
	const institutionsByName = new Map(
		configuredInstitutions
			.filter(
				(
					institution,
				): institution is RuntimeInstitution & { logoUrl: string } =>
					Boolean(institution.logoUrl),
			)
			.map((institution) => [
				institutionNameKey(institution.name),
				institution,
			]),
	);

	for (const name of names) {
		const institution = institutionsByName.get(
			institutionNameKey(name),
		);
		if (institution) return institution;
	}

	return undefined;
}
