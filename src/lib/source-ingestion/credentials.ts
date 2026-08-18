import type { LibraryServerConfig } from "@/config/library-config/schema";

export type SourceCredentialResolver = (
	sourceKey: string,
) => Promise<string | null>;

export class SourceCredentialNotFoundError extends Error {
	constructor(sourceKey: string) {
		super(`No API key is configured for source ${sourceKey}.`);
		this.name = "SourceCredentialNotFoundError";
	}
}

export function createManifestSourceCredentialResolver(
	sources: LibraryServerConfig["sources"],
): SourceCredentialResolver {
	const credentials = new Map(
		sources.map((source) => [source.key, source.apiKey] as const),
	);
	return async (sourceKey) => {
		const apiKey = credentials.get(sourceKey);
		if (!apiKey) {
			throw new SourceCredentialNotFoundError(sourceKey);
		}
		return apiKey;
	};
}
