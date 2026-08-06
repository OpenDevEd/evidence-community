import { createEnvironmentCredentialResolver } from "@/lib/source-ingestion/credentials";

import { SourceWritebackAdapterRegistry } from "./adapter";
import {
	createZoteroWritebackAdapter,
	type ZoteroWritebackAdapterOptions,
} from "./zotero/adapter";

export type SourceWritebackRuntimeOptions = {
	zotero?: ZoteroWritebackAdapterOptions;
};

export function createSourceWritebackRuntime(
	options: SourceWritebackRuntimeOptions = {},
) {
	return {
		credentialResolver: createEnvironmentCredentialResolver(),
		registry: new SourceWritebackAdapterRegistry([
			createZoteroWritebackAdapter(options.zotero),
		]),
	};
}
