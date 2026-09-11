import type { LibraryServerConfig } from "@/config/library-config/schema";

export function libraryEmailIdentity(
	config: Pick<LibraryServerConfig, "identity" | "theme">,
) {
	return {
		name: config.identity.name,
		baseUrl: config.identity.baseUrl,
		accent: config.theme.colors.accent,
		logoUrl:
			config.identity.assets.icons.find((icon) =>
				/\.png(?:\?|$)/.test(icon),
			) ||
			config.identity.assets.logoLight ||
			config.identity.assets.logoDark,
	};
}
