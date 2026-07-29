import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";

import { RevisionAwareFileStorageFactory } from "./file-storage";

const globalFileStorage = globalThis as typeof globalThis & {
	__evidenceLibraryFileStorageFactory?: RevisionAwareFileStorageFactory;
};

const fileStorageFactory =
	globalFileStorage.__evidenceLibraryFileStorageFactory ??
	new RevisionAwareFileStorageFactory();

globalFileStorage.__evidenceLibraryFileStorageFactory =
	fileStorageFactory;

export async function getNativeFileRuntime() {
	const config = await getLibraryConfig();
	return {
		config,
		db: await getDatabaseForConfig(config),
		storage: await fileStorageFactory.get({
			configuration: config.services.storage,
			revision: config.revision,
			updatedAt: config.updatedAt,
		}),
	};
}
