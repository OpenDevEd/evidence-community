import type { LibraryServerConfig } from "@/config/library-config/schema";
import { createManifestSourceCredentialResolver } from "@/lib/source-ingestion/credentials";

import { SourceWritebackAdapterRegistry } from "./adapter";
import {
	createZoteroWritebackAdapter,
	type ZoteroWritebackAdapterOptions,
} from "./zotero/adapter";

export type SourceWritebackRuntimeOptions = {
	zotero?: ZoteroWritebackAdapterOptions;
};

export function createSourceWritebackRuntime(
	config: LibraryServerConfig,
	options: SourceWritebackRuntimeOptions = {},
) {
	return {
		credentialResolver: createManifestSourceCredentialResolver(
			config.sources,
		),
		registry: new SourceWritebackAdapterRegistry([
			createZoteroWritebackAdapter(options.zotero),
		]),
	};
}
