import type { Metadata } from "next";

import type {
	LibraryPublicConfig,
	LibraryServerConfig,
} from "./schema";

type LibraryIdentityConfig =
	| LibraryPublicConfig["identity"]
	| LibraryServerConfig["identity"];

export const LIBRARY_LOGO_DATA_ATTRIBUTE = "data-library-logo";
export const LIBRARY_LOGO_ATTRIBUTES = {
	[LIBRARY_LOGO_DATA_ATTRIBUTE]: "",
} as const;
export const LIBRARY_LOGO_SELECTOR = `[${LIBRARY_LOGO_DATA_ATTRIBUTE}]`;

export function buildLibraryMetadata(
	identity: LibraryIdentityConfig,
): Metadata {
	const { assets, baseUrl, name, shortName } = identity;
	const icons = Array.from(new Set([assets.favicon, ...assets.icons]));

	return {
		applicationName: shortName,
		description: name,
		icons: {
			icon: icons,
			shortcut: assets.favicon,
		},
		metadataBase: new URL(baseUrl),
		title: name,
	};
}

export function buildLibraryLogoCss(
	identity: LibraryIdentityConfig,
): string | null {
	const logoStyles = identity.assets.logoStyles.trim();
	if (!logoStyles) return null;

	return `${LIBRARY_LOGO_SELECTOR} {\n${logoStyles}\n}`;
}
