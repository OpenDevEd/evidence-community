import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type PublicationRuntimeConfig =
	LibraryServerConfig["services"]["publication"];

export async function getPublicationRuntimeConfig() {
	const config = await getLibraryConfig();
	return config.services.publication;
}
