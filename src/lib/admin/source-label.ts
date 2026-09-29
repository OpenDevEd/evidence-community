import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";

const PROVIDER_NAMES: Record<string, string> = {
	openalex: "OpenAlex",
	openscholar: "OpenScholar",
	zotero: "Zotero",
};

export function sourceProviderName(provider: string) {
	return (
		PROVIDER_NAMES[provider] ??
		`${provider[0]!.toUpperCase()}${provider.slice(1)}`
	);
}

/**
 * The one place that turns a source connection into the words an admin sees.
 * The source's own name wins (for example the Zotero group name, read by the
 * sync worker). Without it, the provider and scope id are shown.
 */
export function sourceDisplayLabel(
	connection: {
		displayName?: string | null;
		externalScopeKey: string | null;
		key: string;
		provider: string;
	},
	options: { includeIdentifier?: boolean } = {},
) {
	if (connection.provider === NATIVE_SOURCE_CONNECTION_KEY) return "Native";
	// OpenAlex keys and OpenScholar collection ids are generated, so they tell a reader nothing.
	const scope =
		connection.provider === "openalex" || connection.provider === "openscholar"
			? null
			: (connection.externalScopeKey ?? connection.key);
	const provider = sourceProviderName(connection.provider);
	const identifier = scope ? `${provider} ${scope}` : provider;
	const name = connection.displayName?.trim();
	if (name) {
		return options.includeIdentifier
			? `${name} (${identifier})`
			: name;
	}
	return identifier;
}
