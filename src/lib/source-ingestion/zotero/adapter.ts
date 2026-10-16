import type { SourceAdapter } from "../adapter";
import type { ZoteroAttachmentProcessor } from "./mapper";
import { syncZoteroSource } from "./sync";

type Fetch = typeof fetch;

export type ZoteroSourceAdapterOptions = {
	attachmentProcessor: ZoteroAttachmentProcessor;
	fetch?: Fetch;
	/** The library-wide publish tags a source read before it had its own PDF rule was read under. */
	legacyPublishTags?: readonly string[];
	sleep?: (milliseconds: number) => Promise<void>;
};

export function createZoteroSourceAdapter(
	options: ZoteroSourceAdapterOptions,
): SourceAdapter {
	return {
		provider: "zotero",
		async sync(context) {
			await context.heartbeat();
			const result = await syncZoteroSource({
				attachmentProcessor: options.attachmentProcessor,
				credentialResolver: context.credentialResolver,
				database: context.database,
				fetch: options.fetch,
				legacyPublishTags: options.legacyPublishTags,
				run: context.run,
				sleep: options.sleep,
				sourceConnectionKey: context.sourceConnection.key,
			});
			await context.heartbeat();
			return result;
		},
	};
}
