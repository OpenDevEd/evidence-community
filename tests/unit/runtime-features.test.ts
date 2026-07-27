import { describe, expect, it } from "vitest";

import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
	type LibraryFeatures,
} from "@/config/library-config/features";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { createLibraryConfigSchema } from "@/config/library-config/schema";
import {
	libraryCollectionIds,
	libraryInstitutionNames,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const featureIds = [
	"themeSwitcher",
	"languageSwitcher",
	"login",
	"navbarSearch",
	"userCollections",
	"ai",
	"aiSearch",
	"deepResearch",
	"relatedResources",
	"collections",
	"collectionNotes",
	"countryFocus",
	"authorFilter",
	"authorLocation",
	"yearsDropdown",
	"downloads",
	"atomFeed",
] as const satisfies readonly LibraryFeatureId[];

const schema = createLibraryConfigSchema({
	collectionIds: libraryCollectionIds,
	institutionNames: libraryInstitutionNames,
});

describe("runtime library feature selector", () => {
	const publicConfig = projectPublicLibraryConfig(
		schema.parse(maximalLibraryConfig),
	);

	it("covers every approved feature in the public runtime manifest", () => {
		expect(Object.keys(publicConfig.features).sort()).toEqual(
			[...featureIds].sort(),
		);
	});

	it.each(featureIds)("reads %s independently", (featureId) => {
		const enabledFeatures: LibraryFeatures = {
			...publicConfig.features,
			[featureId]: true,
		};
		const disabledFeatures: LibraryFeatures = {
			...publicConfig.features,
			[featureId]: false,
		};

		expect(isLibraryFeatureEnabled(enabledFeatures, featureId)).toBe(true);
		expect(isLibraryFeatureEnabled(disabledFeatures, featureId)).toBe(false);
	});
});
