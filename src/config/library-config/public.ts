import {
	publicLibraryConfigSchema,
	type LibraryPublicConfig,
	type LibraryServerConfig,
} from "./schema";
import { getEnabledGapMaps } from "./gap-maps";

const publicConfigCache = new WeakMap<
	LibraryServerConfig,
	LibraryPublicConfig
>();

export function projectPublicLibraryConfig(
	config: LibraryServerConfig,
): LibraryPublicConfig {
	const cached = publicConfigCache.get(config);
	if (cached) return cached;

	const publicConfig = publicLibraryConfigSchema.parse({
		schemaVersion: config.schemaVersion,
		revision: config.revision,
		updatedAt: config.updatedAt,
		identity: config.identity,
		institutions: config.institutions,
		theme: config.theme,
		navigation: config.navigation,
		footer: config.footer,
		contact: config.contact,
		legal: config.legal,
		localization: config.localization,
		search: config.search,
		filters: config.filters,
		content: config.content,
		citations: config.citations,
		features: config.features,
		collections: config.collections,
		gapMaps: getEnabledGapMaps(config.gapMaps),
		exports: {
			ris: Boolean(config.exports.ris),
			bibtex: Boolean(config.exports.bibtex),
			atom: Boolean(config.exports.atom),
		},
		ai: {
			providers: config.ai.providers.map((provider) => ({
				provider: provider.provider,
				enabled: provider.enabled,
				defaultModel: provider.defaultModel,
				largeModel: provider.largeModel,
				smallModel: provider.smallModel,
			})),
		},
		analytics: config.analytics,
	});

	publicConfigCache.set(config, publicConfig);
	return publicConfig;
}
