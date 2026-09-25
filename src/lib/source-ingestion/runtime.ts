import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { createSupabaseFileStorage } from "@/lib/admin/file-storage";

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
	);
	const attachmentProcessor = createZoteroAttachmentProcessor({
		database,
		maxPdfBytes: config.services.storage.maxPdfBytes,
		publishTags: config.content.tags.publish,
		storage,
	});

	return {
		credentialResolver,
		registry: createDefaultSourceAdapterRegistry({
			zotero: { attachmentProcessor },
			openalex: {
				attachmentProcessor: createOpenAlexAttachmentProcessor({
					database,
					storage,
					maxPdfBytes: config.services.storage.maxPdfBytes,
				}),
			},
		}),
		storage,
	};
}
