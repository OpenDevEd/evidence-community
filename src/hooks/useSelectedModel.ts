import { models } from "@/constants/ai";
import { useLocalStorage } from "usehooks-ts";

export function useSelectedModel() {
	const [selectedModelValue, setSelectedModel] = useLocalStorage("ai-model", 0);
	const selectedModel = selectedModelValue >= models.length ? 0 : selectedModelValue;
    const modelObject = models[selectedModel];

	return {
		selectedModel,
		setSelectedModel,
		modelObject,
	}
}