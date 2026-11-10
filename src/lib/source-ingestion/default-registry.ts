import { SourceAdapterRegistry, type SourceAdapter } from "./adapter";
import { createAddedPapersSourceAdapter, type AddedPapersSourceOptions } from "./added/sync";
import { createOpenAlexSourceAdapter } from "./openalex/adapter";
import type { OpenAlexSourceOptions } from "./openalex/sync";
import { createOpenScholarSourceAdapter } from "./openscholar/adapter";
import type { OpenScholarSourceOptions } from "./openscholar/sync";
import {
	createZoteroSourceAdapter,
	type ZoteroSourceAdapterOptions,
} from "./zotero/adapter";

export type DefaultSourceAdapterRegistryOptions = {
	additionalAdapters?: readonly SourceAdapter[];
	zotero: ZoteroSourceAdapterOptions;
	openalex?: OpenAlexSourceOptions;
	/** Without it, OpenScholar collections have no adapter, as in tools that only read other sources. */
	openscholar?: OpenScholarSourceOptions;
	/** Without it, the Added papers source has no adapter, as in tools that only read other sources. */
	added?: AddedPapersSourceOptions;
};

export function createDefaultSourceAdapterRegistry(
	options: DefaultSourceAdapterRegistryOptions,
) {
	return new SourceAdapterRegistry([
		createZoteroSourceAdapter(options.zotero),
		createOpenAlexSourceAdapter(options.openalex),
		...(options.openscholar ? [createOpenScholarSourceAdapter(options.openscholar)] : []),
		...(options.added ? [createAddedPapersSourceAdapter(options.added)] : []),
		...(options.additionalAdapters ?? []),
	]);
}
