import { COUNTRY_HIERARCHY, Entry } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { meilisearchEquals } from "@/lib/meilisearch-filter";

/** Adds the continents and regions to each country facet, the country focus and the authors' countries, keeping the chosen places. */
export function addRegionsToFacetDistribution(
	facetDistribution: FacetDistribution,
	queryParams: { country: string[]; author_country: string[] },
) {
	if (facetDistribution?.country) addHierarchyToFacet(facetDistribution, "country", queryParams.country);
	if (facetDistribution?.authorCountry) addHierarchyToFacet(facetDistribution, "authorCountry", queryParams.author_country);
	return facetDistribution;
}

export function addHierarchyToFacet(
	facetDistribution: FacetDistribution,
	facetName: string,
	queryParams: string[] = [],
) {
	if (!facetDistribution || !facetDistribution[facetName]) return;

	const countryPaths: Record<string, string> = {};
	const pathToCountry: Record<string, string> = {};

	const continentPaths: Set<string> = new Set();
	const regionPaths: Record<string, Set<string>> = {};

	const buildCountryPaths = (entry: Entry, parentPath: string = "") => {
		if (entry.label === "World" && !parentPath) {
			entry.children?.forEach((child) => {
				buildCountryPaths(child, "");
			});
			return;
		}

		const currentPath = parentPath
			? `${parentPath} > ${entry.label}`
			: entry.label;

		if (parentPath === "") {
			continentPaths.add(currentPath);
			regionPaths[currentPath] = new Set();
		} else if (!entry.children) {
			countryPaths[entry.label] = currentPath;
			pathToCountry[currentPath] = entry.label;
		} else {
			const continentPath = parentPath.split(" > ")[0];
			regionPaths[continentPath].add(currentPath);
		}

		if (!entry.children) return;

		for (const child of entry.children) {
			buildCountryPaths(child, currentPath);
		}
	};

	buildCountryPaths(COUNTRY_HIERARCHY);

	const originalDistribution = { ...facetDistribution[facetName] };

	const selectedContinents = new Set<string>();
	const selectedRegions = new Set<string>();
	const selectedCountries = new Set<string>();

	for (const param of queryParams) {
		if (param.includes(" > ")) {
			const parts = param.split(" > ");
			if (parts.length >= 1) {
				selectedContinents.add(parts[0]);

				if (parts.length >= 2) {
					const prefix = parts.slice(0, 2).join(" > ");

					for (const continent of continentPaths) {
						for (const region of regionPaths[continent]) {
							if (region.startsWith(prefix)) {
								selectedRegions.add(region);
							}
						}
					}

					if (
						parts.length === 2 &&
						regionPaths[parts[0]]?.has(param)
					) {
						selectedRegions.add(param);
					}

					if (
						parts.length === 3 ||
						(parts.length === 2 && parts[1].length === 2)
					) {
						selectedCountries.add(param);
					}
				}
			}
		} else if (param.length === 2) {
			if (countryPaths[param]) {
				const parts = countryPaths[param].split(" > ");
				selectedContinents.add(parts[0]);
				if (parts.length > 1) {
					selectedRegions.add(parts.slice(0, 2).join(" > "));
				}
				selectedCountries.add(countryPaths[param]);
			}
		} else {
			if (continentPaths.has(param)) {
				selectedContinents.add(param);
			} else {
				for (const continent of continentPaths) {
					for (const region of regionPaths[continent]) {
						const regionName = region.split(" > ").pop() || "";
						if (regionName === param) {
							selectedContinents.add(continent);
							selectedRegions.add(region);
						}
					}
				}
			}
		}
	}

	facetDistribution[facetName] = {};

	const processEntry = (entry: Entry, parentPath: string = ""): number => {
		if (entry.label === "World" && !parentPath) {
			let total = 0;
			entry.children?.forEach((child) => {
				total += processEntry(child, "");
			});
			return total;
		}

		let total = 0;
		const currentPath = parentPath
			? `${parentPath} > ${entry.label}`
			: entry.label;

		if (!entry.children) {
			return originalDistribution[entry.label] || 0;
		}

		for (const child of entry.children) {
			total += processEntry(child, currentPath);
		}

		// Always include entries with counts, regardless of selection
		if (total > 0) {
			facetDistribution[facetName][currentPath] = total;
		}

		return total;
	};

	processEntry(COUNTRY_HIERARCHY);

	// Always include all country-level entries that have counts
	for (const countryCode in originalDistribution) {
		if (countryPaths[countryCode]) {
			const fullPath = countryPaths[countryCode];
			if (originalDistribution[countryCode] > 0) {
				facetDistribution[facetName][fullPath] =
					originalDistribution[countryCode];
			}
		}
	}
}

export function extractCountryCodes(entry: Entry): string[] {
	if (!entry.children) {
		return [entry.label];
	}

	return entry.children.flatMap((child) => extractCountryCodes(child));
}

export function findEntryByPath(path: string): Entry | null {
	const parts = path.split(" > ");
	let currentEntry = COUNTRY_HIERARCHY;

	if (parts[0] !== currentEntry.label) {
		const continentMatch = currentEntry.children?.find(
			(child) => child.label === parts[0],
		);
		if (!continentMatch) return null;
		currentEntry = continentMatch;
		parts.shift();
	} else {
		parts.shift();
	}

	for (const part of parts) {
		const matchingChild = currentEntry.children?.find(
			(child) => child.label === part,
		);
		if (!matchingChild) return null;
		currentEntry = matchingChild;
	}

	return currentEntry;
}

export function extractCountryCode(path: string): string {
	const parts = path.split(" > ");
	return parts[parts.length - 1];
}

export function buildCountryFilters(selections: string[]): string | null {
	return buildHierarchicalFilters(selections, "country");
}

export function buildHierarchicalFilters(
	selections: string[],
	filterAttribute: string,
): string | null {
	if (!selections.length) return null;

	const continentSelections = new Set<string>();
	const regionSelections: Record<string, Set<string>> = {};
	const countrySelections: Record<string, Set<string>> = {};

	for (const selection of selections) {
		const parts = selection.split(" > ");

		if (parts.length === 1) {
			if (parts[0].length === 2) {
				if (!countrySelections["direct"]) {
					countrySelections["direct"] = new Set();
				}
				countrySelections["direct"].add(parts[0]);
			} else {
				continentSelections.add(parts[0]);
			}
		} else if (parts.length === 2) {
			const continent = parts[0];
			const second = parts[1];

			if (second.length === 2) {
				if (!countrySelections[continent]) {
					countrySelections[continent] = new Set();
				}
				countrySelections[continent].add(second);
			} else {
				if (!regionSelections[continent]) {
					regionSelections[continent] = new Set();
				}
				regionSelections[continent].add(selection);
			}
		} else if (parts.length === 3) {
			const continent = parts[0];
			const region = `${parts[0]} > ${parts[1]}`;
			const country = parts[2];

			if (!countrySelections[region]) {
				countrySelections[region] = new Set();
			}
			countrySelections[region].add(country);
		}
	}

	const filterParts: string[] = [];

	if (countrySelections["direct"] && countrySelections["direct"].size > 0) {
		const countries = Array.from(countrySelections["direct"]);
		filterParts.push(
			...countries.map((code) =>
				meilisearchEquals(filterAttribute, code),
			),
		);
	}

	for (const continent of continentSelections) {
		const hasRegions =
			regionSelections[continent] && regionSelections[continent].size > 0;
		const hasCountries =
			countrySelections[continent] &&
			countrySelections[continent].size > 0;

		if (!hasRegions && !hasCountries) {
			const entry = findEntryByPath(continent);
			if (entry) {
				const countryCodes = extractCountryCodes(entry);
				const filter = countryCodes
					.map((code) => meilisearchEquals(filterAttribute, code))
					.join(" OR ");
				if (filter) {
					filterParts.push(`(${filter})`);
				}
			}
		}
	}

	for (const continent in regionSelections) {
		for (const region of regionSelections[continent]) {
			const hasCountries =
				countrySelections[region] && countrySelections[region].size > 0;

			if (!hasCountries) {
				const entry = findEntryByPath(region);
				if (entry) {
					const countryCodes = extractCountryCodes(entry);
					const filter = countryCodes
						.map((code) => meilisearchEquals(filterAttribute, code))
						.join(" OR ");
					if (filter) {
						filterParts.push(`(${filter})`);
					}
				}
			}
		}
	}

	for (const parent in countrySelections) {
		if (parent === "direct") continue;

		const countries = Array.from(countrySelections[parent]);
		filterParts.push(
			...countries.map((code) =>
				meilisearchEquals(filterAttribute, code),
			),
		);
	}

	if (filterParts.length === 0) return null;
	if (filterParts.length === 1) return filterParts[0];

	return filterParts.join(" AND ");
}

export function createCountryFilters(
	countrySelections: string[] = [],
	authorCountrySelections: string[] = [],
): string[] {
	return [buildCountryFilters(countrySelections), buildHierarchicalFilters(authorCountrySelections, "authorCountry")].filter((filter): filter is string => filter !== null);
}
