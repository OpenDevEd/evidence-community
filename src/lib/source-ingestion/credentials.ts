import type { LibraryServerConfig } from "@/config/library-config/schema";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

export type SourceCredentialResolver = (
	sourceKey: string,
) => Promise<string | null>;

export class SourceCredentialNotFoundError extends Error {
	constructor(sourceKey: string) {
		super(`No API key is configured for source ${sourceKey}.`);
		this.name = "SourceCredentialNotFoundError";
	}
}

/**
 * Each configured source's key, and for the Added papers source, which no setting lists, the community's own
 * OpenAlex key (`services.openAlex`).
 */
export function createManifestSourceCredentialResolver(
	sources: LibraryServerConfig["sources"],
	openAlexApiKey?: string,
): SourceCredentialResolver {
	const credentials = new Map<string, string | undefined>([
		...sources.map((source) => [source.key, source.apiKey] as const),
		[ADDED_PAPERS_SOURCE_CONNECTION_KEY, openAlexApiKey],
	]);
	return async (sourceKey) => {
		const apiKey = credentials.get(sourceKey);
		if (!apiKey) {
			throw new SourceCredentialNotFoundError(sourceKey);
		}
		return apiKey;
	};
}
