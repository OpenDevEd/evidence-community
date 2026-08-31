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
	const { assets, baseUrl, description, name, shortName } = identity;
	const icons = [
		...Array.from(new Set([assets.favicon, ...assets.icons])),
		...(assets.faviconLight
			? [
					{
						url: assets.faviconLight,
						media: "(prefers-color-scheme: light)",
					},
				]
			: []),
		...(assets.faviconDark
			? [
					{
						url: assets.faviconDark,
						media: "(prefers-color-scheme: dark)",
					},
				]
			: []),
	];
	const pageDescription = description ?? name;
	const shareImages = assets.shareImage ? [assets.shareImage] : undefined;

	return {
		applicationName: shortName,
		description: pageDescription,
		icons: {
			icon: icons,
			shortcut: assets.favicon,
		},
		metadataBase: new URL(baseUrl),
		openGraph: {
			title: name,
			description: pageDescription,
			siteName: name,
			images: shareImages,
		},
		title: name,
		twitter: {
			card: shareImages ? "summary_large_image" : "summary",
			title: name,
			description: pageDescription,
			images: shareImages,
		},
	};
}

export function buildLibraryLogoCss(
	identity: LibraryIdentityConfig,
): string | null {
	const logoStyles = identity.assets.logoStyles.trim();
	if (!logoStyles) return null;

	return `${LIBRARY_LOGO_SELECTOR} {\n${logoStyles}\n}`;
}
