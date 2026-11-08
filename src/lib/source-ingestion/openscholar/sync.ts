import { OpenScholarServiceError, type OpenScholarService } from "@/lib/openscholar-service";

import type { SourceAdapterContext, SourceSyncResult } from "../adapter";
import { saveSourceDisplayName } from "../display-name";
import { openAlexIdStream } from "../openalex/id-stream";
import { openAlexWorksConfigSchema } from "../openalex/schema";
import {
	openAlexWorksAreDue,
	savedOpenAlexWorksVersion,
	syncOpenAlexWorks,
	withdrawOpenAlexWorks,
	type OpenAlexSourceOptions,
} from "../openalex/sync";
import { OpenScholarCollectionGoneError, readOpenScholarCollection } from "./client";

export type OpenScholarSourceOptions = OpenAlexSourceOptions & { service: OpenScholarService };

function goneCode(error: unknown) {
	if (!(error instanceof OpenScholarServiceError)) return null;
	if (error.code === "owner_left") return "owner_left" as const;
	return error.code === "collection_not_found" ? ("not_found" as const) : null;
}

/**
 * Follows one OpenScholar collection. Every sweep asks whether it changed,
 * which costs one small request; a change imports it again, and a collection
 * the library lost access to has its works withdrawn.
 */
export async function syncOpenScholarCollection(
	context: SourceAdapterContext,
	options: OpenScholarSourceOptions,
): Promise<SourceSyncResult> {
	const connection = context.sourceConnection;
	const config = openAlexWorksConfigSchema.parse(connection.config);
	const collectionId = connection.externalScopeKey!;
	const read = async (knownVersion: string | null) => {
		try {
			return await readOpenScholarCollection(options.service, collectionId, knownVersion, { fetch: options.fetch });
		} catch (error) {
			const gone = goneCode(error);
			if (!gone) throw error;
			await withdrawOpenAlexWorks(context);
			throw new OpenScholarCollectionGoneError(gone, collectionId);
		}
	};
	let collection = await read(savedOpenAlexWorksVersion(connection.syncCursor));
	await saveSourceDisplayName(context.database, connection, async () => collection.name);
	if (collection.unchanged) {
		const due = openAlexWorksAreDue(connection.syncCursor, { version: collection.version, downloadPdfs: config.downloadPdfs }, new Date());
		if (!due) return { unchanged: true, version: collection.version };
		collection = await read(null);
		if (collection.unchanged) throw new Error(`Openscholar collection ${collectionId} answered without its items`);
	}
	const result = await syncOpenAlexWorks(
		context,
		openAlexIdStream(collection.openAlexIds, collection.version, config.downloadPdfs),
		options,
	);
	return { ...result, unresolved: collection.unresolved };
}
