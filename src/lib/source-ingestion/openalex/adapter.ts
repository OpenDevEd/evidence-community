import type { SourceAdapter } from "../adapter";
import { syncOpenAlexSource, type OpenAlexSourceOptions } from "./sync";

export function createOpenAlexSourceAdapter(
	options: OpenAlexSourceOptions = {},
): SourceAdapter {
	return {
		provider: "openalex",
		sync: (context) => syncOpenAlexSource(context, options),
	};
}
