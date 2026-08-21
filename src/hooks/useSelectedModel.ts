import { getAIProviderPresentation } from "@/constants/ai";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import type { AIProviderId } from "@/lib/ai-provider-factory";
import { useLocalStorage } from "usehooks-ts";

export function useSelectedModel() {
	const { ai } = useLibraryConfig();
	const availableProviders = ai.providers.filter(
		(provider) => provider.enabled && provider.defaultModel,
	);
	const fallbackProvider = availableProviders[0]?.provider ?? null;
	const [storedProvider, setSelectedProvider] =
		useLocalStorage<AIProviderId | null>(
			"ai-provider",
			fallbackProvider,
		);
	const selectedProvider =
		availableProviders.find(
			(provider) => provider.provider === storedProvider,
		) ?? availableProviders[0] ?? null;
	const selectedProviderId = selectedProvider?.provider ?? null;
	// The chat backend picks a model, not a provider: it is the default model
	// this library configured for the chosen provider.
	const selectedModelId = selectedProvider?.defaultModel ?? null;
	const providerPresentation =
		getAIProviderPresentation(selectedProviderId);

	return {
		availableProviders,
		selectedProvider,
		selectedProviderId,
		selectedModelId,
		setSelectedProvider,
		providerPresentation,
	}
}
