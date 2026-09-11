import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";

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
	const identifier = `${connection.provider[0]!.toUpperCase()}${connection.provider.slice(1)} ${
		connection.externalScopeKey ?? connection.key
	}`;
	const name = connection.displayName?.trim();
	if (name) {
		return options.includeIdentifier
			? `${name} (${identifier})`
			: name;
	}
	return identifier;
}
