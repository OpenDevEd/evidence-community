import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";

import {
	buildAdminPublicationViewFromSnapshot,
	type AdminPublicationView,
} from "./admin-publication-view";
import { loadPublicationRecordExtras } from "./record-extras";
import { readPublicationRepositorySnapshot } from "./repository";

export async function buildAdminPublicationView(
	itemKey: string,
): Promise<AdminPublicationView> {
	const config = await getLibraryConfig();
	const database = await getDatabaseForConfig(config);
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		config.services.publication.crossref.environment,
	);
	const extras = await loadPublicationRecordExtras(database, snapshot, config).catch(
		(error: unknown) => new Error(`The details its deposit carries couldn't be read, so it can't be compared now: ${error instanceof Error ? error.message : String(error)}`),
	);
	return buildAdminPublicationViewFromSnapshot({ itemKey, snapshot, config, extras });
}
