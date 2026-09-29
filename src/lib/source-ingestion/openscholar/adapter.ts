import type { SourceAdapter } from "../adapter";
import { syncOpenScholarCollection, type OpenScholarSourceOptions } from "./sync";

/** Runs every sweep, like Zotero: asking OpenScholar whether a collection changed costs one small request. */
export function createOpenScholarSourceAdapter(options: OpenScholarSourceOptions): SourceAdapter {
	return {
		provider: "openscholar",
		sync: (context) => syncOpenScholarCollection(context, options),
	};
}
