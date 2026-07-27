import type { LibraryPublicConfig } from "./schema";

export type LibraryFeatures = LibraryPublicConfig["features"];
export type LibraryFeatureId = keyof LibraryFeatures;

export function isLibraryFeatureEnabled(
	features: LibraryFeatures,
	feature: LibraryFeatureId,
) {
	return features[feature];
}
