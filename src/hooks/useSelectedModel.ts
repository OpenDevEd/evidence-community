import { useLocalStorage } from "usehooks-ts";

import { getAIModelPresentation } from "@/constants/ai";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { selectableAIModels, defaultAIModelId } from "@/lib/ai/models";

/**
 * The model this reader picked. Libraries offer the models they configured,
 * and a stored choice the library no longer offers falls back to the first
 * one it does.
 */
export function useSelectedModel() {
	const { ai } = useLibraryConfig();
	const models = selectableAIModels(ai.providers);
	const [storedModelId, setSelectedModelId] = useLocalStorage<string | null>(
		"ai-model",
		null,
	);

	const selectedModel =
		models.find((model) => model.id === storedModelId) ??
		models.find((model) => model.id === defaultAIModelId(ai.providers)) ??
		null;
	const selectedModelId = selectedModel?.id ?? null;

	return {
		models,
		selectedModel,
		selectedModelId,
		setSelectedModelId,
		modelPresentation: getAIModelPresentation(
			selectedModelId,
			ai.providers,
		),
	};
}
