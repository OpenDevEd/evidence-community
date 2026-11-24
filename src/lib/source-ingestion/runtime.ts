import { paperLookupFor } from "@/lib/admin/added-papers-service";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { createSupabaseFileStorage } from "@/lib/admin/file-storage";
import { storedPdfLink } from "@/lib/openscholar-service";

import { createOpenAlexAttachmentProcessor } from "./openalex/attachment-processor";
import { createManifestSourceCredentialResolver } from "./credentials";
import { createDefaultSourceAdapterRegistry } from "./default-registry";
import { createZoteroAttachmentProcessor } from "./zotero/attachment-processor";

export function createSourceSyncRuntime(
	config: LibraryServerConfig,
	database: Database,
) {
	const storage = createSupabaseFileStorage(config.services.storage);
	const credentialResolver = createManifestSourceCredentialResolver(
		config.sources,
		config.services.openAlex?.apiKey,
	);
	const attachmentProcessor = createZoteroAttachmentProcessor({
		database,
		maxPdfBytes: config.services.storage.maxPdfBytes,
		storage,
	});

	// OpenScholar collections are OpenAlex works, so they share its PDF pipeline.
	const openalex = {
		attachmentProcessor: createOpenAlexAttachmentProcessor({
			database,
			storage,
			maxPdfBytes: config.services.storage.maxPdfBytes,
			storedCopy: (paper) => storedPdfLink(config.authentication.openScholar, paper),
		}),
	};

	return {
		credentialResolver,
		registry: createDefaultSourceAdapterRegistry({
			zotero: { attachmentProcessor, legacyPublishTags: config.content.tags.publish },
			openalex,
			// A collection paper OpenAlex doesn't have is made from its DOI, as Added papers makes one.
			openscholar: { ...openalex, service: config.authentication.openScholar, recordByDoi: paperLookupFor(config).recordByDoi },
			// Openscholar says which added papers are its reports, so they follow it and not OpenAlex.
			added: { ...openalex, service: config.authentication.openScholar },
		}),
		storage,
	};
}
