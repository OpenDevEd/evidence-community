import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { createElement, type ComponentType } from "react";
import ChatGPT from "@/components/icons/ChatGPT";
import Claude from "@/components/icons/Claude";
import DeepSeek from "@/components/icons/DeepSeek";
import Gemini from "@/components/icons/Gemini";
import Grok from "@/components/icons/Grok";
import Zai from "@/components/icons/Zai";
import Mistral from "@/components/icons/Mistral";
import {
	getAIModel,
	isAIModelId,
	type ConfiguredAIProvider,
} from "@/lib/ai/models";

export type AIModelPresentation = {
	name: string;
	company: string;
	icon: ComponentType<{ className?: string }>;
};

const COMPANY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
	Anthropic: Claude,
	DeepSeek: DeepSeek,
	Google: Gemini,
	Mistral: Mistral,
	OpenAI: ChatGPT,
	xAI: Grok,
	"Z.ai": Zai,
};

function SparklesModelIcon({ className }: { className?: string }) {
	return createElement(HugeiconsIcon, { icon: SparklesIcon, className });
}

export const AI_FALLBACK_PRESENTATION: AIModelPresentation = {
	name: "AI",
	company: "Configured model",
	icon: SparklesModelIcon,
};

/** How a model is named and pictured for the reader. */
export function getAIModelPresentation(
	modelId: unknown,
	providers: readonly ConfiguredAIProvider[] = [],
): AIModelPresentation {
	if (!isAIModelId(modelId)) return AI_FALLBACK_PRESENTATION;

	const model = getAIModel(modelId, providers);
	return {
		name: model.name,
		company: model.company,
		icon: COMPANY_ICONS[model.company] ?? SparklesModelIcon,
	};
}
