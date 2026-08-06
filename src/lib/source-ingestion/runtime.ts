import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { createSupabaseFileStorage } from "@/lib/admin/file-storage";

import { createEnvironmentCredentialResolver } from "./credentials";
import { createDefaultSourceAdapterRegistry } from "./default-registry";
import { createZoteroAttachmentProcessor } from "./zotero/attachment-processor";

export function createSourceSyncRuntime(
	config: LibraryServerConfig,
	database: Database,
) {
	const storage = createSupabaseFileStorage(config.services.storage);
	const credentialResolver = createEnvironmentCredentialResolver();
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
		}),
		storage,
	};
}
