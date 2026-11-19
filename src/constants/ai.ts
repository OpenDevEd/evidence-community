import type { ComponentType, SVGProps } from "react";
import ChatGPT from "@/components/icons/ChatGPT";
import Gemini from "@/components/icons/Gemini";
import Claude from "@/components/icons/Claude";
import { AI_MODELS, type AIModelId } from "@/lib/ai/models";

type ModelIcon = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<AIModelId, ModelIcon> = {
	"anthropic/claude-haiku-5.5": Claude,
	"openai/gpt-6-luna": ChatGPT,
	"google/gemini-4-hydrogen": Gemini,
};

const allModels = AI_MODELS.map((model) => ({
	...model,
	icon: icons[model.id],
}));

export const models = allModels.filter(({ hidden }) => !hidden);

export function findAIModelForUI(modelId: unknown) {
	return typeof modelId === "string"
		? allModels.find((model) => model.id === modelId)
		: undefined;
}

export function getAIModelForUI(modelId: AIModelId) {
	const model = findAIModelForUI(modelId);
	if (!model) throw new Error(`Unknown AI model: ${modelId}`);
	return model;
}
