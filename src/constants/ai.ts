import type { ComponentType, SVGProps } from "react";
import ChatGPT from "@/components/icons/ChatGPT";
import Gemini from "@/components/icons/Gemini";
import Grok from "@/components/icons/Grok";
import Claude from "@/components/icons/Claude";
import { AI_MODELS, type AIModelId } from "@/lib/ai/models";

type ModelIcon = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<AIModelId, ModelIcon> = {
	"openai/gpt-5.6-luna": ChatGPT,
	"google/gemini-3.7-flash": Gemini,
	"x-ai/grok-4.6": Grok,
	"anthropic/claude-sonnet-5": Claude,
	"anthropic/claude-opus-5": Claude,
};

const allModels = AI_MODELS.map((model) => ({
	...model,
	icon: icons[model.id],
}));

export const models = allModels.filter(({ hidden }) => !hidden);

export function getAIModelForUI(modelId: AIModelId) {
	return allModels.find((model) => model.id === modelId)!;
}
