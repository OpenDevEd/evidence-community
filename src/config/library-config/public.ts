import {
	publicLibraryConfigSchema,
	type LibraryPublicConfig,
	type LibraryServerConfig,
} from "./schema";
import { getEnabledGapMaps } from "./gap-maps";
import { getRuntimePagePath } from "./links";
import { getRuntimePageAvailability } from "./pages";
import { openScholarSessionCookie } from "@/lib/readers/openscholar";
import { sourcePublishTags } from "@/lib/tags";
import { offersSources } from "@/lib/search-query";
import { libraryResultLimit } from "@/lib/search-filter-constants";

const publicConfigCache = new WeakMap<
	LibraryServerConfig,
	LibraryPublicConfig
>();

function projectPublicSearch(search: LibraryServerConfig["search"]) {
	const { embedder, ...options } = search;
	return { ...options, embeddings: embedder !== null };
}

export function projectPublicLibraryConfig(
	config: LibraryServerConfig,
): LibraryPublicConfig {
	const cached = publicConfigCache.get(config);
	if (cached) return cached;

	// A disabled parent page removes its navigation group, including its children.
	const availablePages = getRuntimePageAvailability(config);
	const pageAvailable = (link: { href: string }) => {
		const pathname = getRuntimePagePath(link.href, config.identity.baseUrl);
		return Object.entries(availablePages).every(([page, enabled]) => page !== pathname || enabled);
	};
	const publicConfig = publicLibraryConfigSchema.parse({
		schemaVersion: config.schemaVersion,
		revision: config.revision,
		updatedAt: config.updatedAt,
		identity: config.identity,
		institutions: config.institutions,
		theme: config.theme,
		navigation: { ...config.navigation, links: config.navigation.links.filter(pageAvailable).map(link => ({ ...link, children: link.children.filter(pageAvailable) })) },
		footer: { ...config.footer, sections: config.footer.sections.map(section => ({ ...section, links: section.links.filter(pageAvailable) })) },
		contact: config.contact,
		legal: config.legal,
		localization: config.localization,
		search: projectPublicSearch(config.search),
		resultLimit: libraryResultLimit(config.services),
		filters: { ...config.filters, sources: { ...config.filters.sources, enabled: offersSources(config) } },
		topics: config.topics,
		content: config.content,
		citations: {
			enabled: config.citations.enabled,
			showUrl: config.citations.showUrl,
		},
		features: config.features,
		collections: config.collections,
		gapMaps: getEnabledGapMaps(config.gapMaps),
		exports: config.exports,
		ai: {
			providers: config.ai.providers.map((provider) => ({
				provider: provider.provider,
				enabled: provider.enabled,
				models: provider.models,
				modelMetadata: provider.modelMetadata,
				defaultModel: provider.defaultModel,
			})),
		},
		analytics: config.analytics,
		notifications: config.notifications,
		authentication: {
			openScholar: {
				accountUrl: config.authentication.openScholar.accountUrl,
				libraryId: config.authentication.openScholar.libraryId,
				sessionCookie: openScholarSessionCookie(config.authentication.openScholar.oauth.issuer),
				// The site of the library's own page there: a library set up from another OpenScholar links to that one.
				siteUrl: new URL(config.authentication.openScholar.libraryUrl).origin,
			},
		},
		sourcePublishTags: sourcePublishTags(config),
	});

	publicConfigCache.set(config, publicConfig);
	return publicConfig;
}
