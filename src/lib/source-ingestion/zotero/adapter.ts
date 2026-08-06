import type { SourceAdapter } from "../adapter";
import type { ZoteroAttachmentProcessor } from "./mapper";
import { syncZoteroSource } from "./sync";

type Fetch = typeof fetch;

export type ZoteroSourceAdapterOptions = {
	attachmentProcessor: ZoteroAttachmentProcessor;
	fetch?: Fetch;
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
				sleep: options.sleep,
				sourceConnectionKey: context.sourceConnection.key,
			});
			await context.heartbeat();
			return result;
		},
	};
}
