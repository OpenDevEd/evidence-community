import "server-only";

import { PLATFORM_AI_PROVIDERS } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	AIProviderUnavailableError,
	RevisionAwareAIProviderFactory,
	type AIProviderId,
} from "./ai-provider-factory";

const globalAIProviders = globalThis as typeof globalThis & {
	__evidenceLibraryAIProviderFactory?: RevisionAwareAIProviderFactory;
};

const aiProviderFactory =
	globalAIProviders.__evidenceLibraryAIProviderFactory ??
	new RevisionAwareAIProviderFactory();

globalAIProviders.__evidenceLibraryAIProviderFactory =
	aiProviderFactory;

export async function getAIProviderForConfig(
	config: Pick<
		LibraryServerConfig,
		"ai" | "revision" | "updatedAt"
	>,
	requestedProvider: unknown,
) {
	if (
		typeof requestedProvider !== "string" ||
		!PLATFORM_AI_PROVIDERS.includes(
			requestedProvider as AIProviderId,
		)
	) {
		throw new AIProviderUnavailableError(
			String(requestedProvider ?? ""),
		);
	}

	const service = await aiProviderFactory.get({
		configuration: config.ai.providers,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
	return service.resolve(requestedProvider as AIProviderId);
}

export {
	AIProviderUnavailableError,
	type AIProviderId,
	type ResolvedAIModels,
} from "./ai-provider-factory";
