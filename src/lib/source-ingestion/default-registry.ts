import { SourceAdapterRegistry, type SourceAdapter } from "./adapter";
import { createOpenAlexSourceAdapter } from "./openalex/adapter";
import type { OpenAlexSourceOptions } from "./openalex/sync";
import {
	createZoteroSourceAdapter,
	type ZoteroSourceAdapterOptions,
} from "./zotero/adapter";

export type DefaultSourceAdapterRegistryOptions = {
	additionalAdapters?: readonly SourceAdapter[];
	zotero: ZoteroSourceAdapterOptions;
	openalex?: OpenAlexSourceOptions;
};

export function createDefaultSourceAdapterRegistry(
	options: DefaultSourceAdapterRegistryOptions,
) {
	return new SourceAdapterRegistry([
		createZoteroSourceAdapter(options.zotero),
		createOpenAlexSourceAdapter(options.openalex),
		...(options.additionalAdapters ?? []),
	]);
}
