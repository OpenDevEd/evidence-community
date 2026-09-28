import type { SourceAdapter } from "../adapter";
import {
	openAlexSyncIsDue,
	syncOpenAlexSource,
	type OpenAlexSourceOptions,
} from "./sync";

export function createOpenAlexSourceAdapter(
	options: OpenAlexSourceOptions = {},
): SourceAdapter {
	return {
		provider: "openalex",
		isDue: openAlexSyncIsDue,
		sync: (context) => syncOpenAlexSource(context, options),
	};
}
