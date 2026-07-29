import {
	SourceAdapterRegistry,
	type SourceAdapter,
} from "./adapter";
import {
	createZoteroSourceAdapter,
	type ZoteroSourceAdapterOptions,
} from "./zotero/adapter";

export type DefaultSourceAdapterRegistryOptions = {
	additionalAdapters?: readonly SourceAdapter[];
	zotero?: ZoteroSourceAdapterOptions;
};

export function createDefaultSourceAdapterRegistry(
	options: DefaultSourceAdapterRegistryOptions = {},
) {
	return new SourceAdapterRegistry([
		createZoteroSourceAdapter(options.zotero),
		...(options.additionalAdapters ?? []),
	]);
}
