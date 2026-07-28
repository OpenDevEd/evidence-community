import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";

export async function getConfigForEnabledFeature(
	feature: LibraryFeatureId,
) {
	const config = await getLibraryConfig();
	return isLibraryFeatureEnabled(config.features, feature)
		? config
		: null;
}

export function featureUnavailableResponse() {
	return Response.json(
		{ error: "Not found" },
		{
			status: 404,
			headers: {
				"Cache-Control": "no-store",
			},
		},
	);
}
