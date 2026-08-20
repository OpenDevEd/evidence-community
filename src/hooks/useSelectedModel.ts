import { getAIModelForUI } from "@/constants/ai";
import {
	DEFAULT_AI_MODEL_ID,
	isSelectableAIModelId,
	type AIModelId,
} from "@/lib/ai/models";
import { useLocalStorage } from "usehooks-ts";

export function useSelectedModel() {
	const [storedModel, setStoredModel] = useLocalStorage<AIModelId | unknown>(
		"ai-model",
		DEFAULT_AI_MODEL_ID,
	);
	const selectedModel = isSelectableAIModelId(storedModel)
		? storedModel
		: DEFAULT_AI_MODEL_ID;
	const modelObject = getAIModelForUI(selectedModel);
	const setSelectedModel = (modelId: AIModelId) => setStoredModel(modelId);

	return {
		selectedModel,
		setSelectedModel,
		modelObject,
	};
}
