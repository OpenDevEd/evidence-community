import type { ComponentType } from "react";
import { BsStars } from "react-icons/bs";

import ChatGPT from "@/components/icons/ChatGPT";
import Claude from "@/components/icons/Claude";
import DeepSeek from "@/components/icons/DeepSeek";
import Gemini from "@/components/icons/Gemini";
import Grok from "@/components/icons/Grok";
import Mistral from "@/components/icons/Mistral";
import { getAIModel, isAIModelId } from "@/lib/ai/models";

export type AIModelPresentation = {
	name: string;
	company: string;
	icon: ComponentType<{ className?: string }>;
};

const COMPANY_ICONS: Record<
	string,
	ComponentType<{ className?: string }>
> = {
	Anthropic: Claude,
	DeepSeek: DeepSeek,
	Google: Gemini,
	Mistral: Mistral,
	OpenAI: ChatGPT,
	xAI: Grok,
};

export const AI_FALLBACK_PRESENTATION: AIModelPresentation = {
	name: "AI",
	company: "Configured model",
	icon: BsStars,
};

/** How a model is named and pictured for the reader. */
export function getAIModelPresentation(
	modelId: unknown,
): AIModelPresentation {
	if (!isAIModelId(modelId)) return AI_FALLBACK_PRESENTATION;

	const model = getAIModel(modelId);
	return {
		name: model.name,
		company: model.company,
		icon: COMPANY_ICONS[model.company] ?? BsStars,
	};
}
