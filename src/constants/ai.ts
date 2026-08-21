
import ChatGPT from "@/components/icons/ChatGPT";
import Gemini from "@/components/icons/Gemini";
import Claude from "@/components/icons/Claude";
import Mistral from "@/components/icons/Mistral";
import DeepSeek from "@/components/icons/DeepSeek";
import type { AIProviderId } from "@/lib/ai-provider-factory";
import type { ComponentType } from "react";
import { BsStars } from "react-icons/bs";

export type AIProviderPresentation = {
	name: string;
	company: string;
	icon: ComponentType<{ className?: string }>;
};

export const AI_PROVIDER_PRESENTATION = {
	anthropic: {
		name: "Claude",
		company: "Anthropic",
		icon: Claude,
	},
	deepseek: {
		name: "DeepSeek",
		company: "DeepSeek",
		icon: DeepSeek,
	},
	google: {
		name: "Gemini",
		company: "Google",
		icon: Gemini,
	},
	mistral: {
		name: "Mistral",
		company: "Mistral",
		icon: Mistral,
	},
	openai: {
		name: "ChatGPT",
		company: "OpenAI",
		icon: ChatGPT,
	},
	openrouter: {
		name: "OpenRouter",
		company: "OpenRouter",
		icon: BsStars,
	},
} satisfies Record<
	AIProviderId,
	AIProviderPresentation
>;

export const AI_FALLBACK_PRESENTATION: AIProviderPresentation = {
	name: "AI",
	company: "Configured provider",
	icon: BsStars,
};

export function getAIProviderPresentation(provider: unknown) {
	if (
		typeof provider === "string" &&
		Object.hasOwn(AI_PROVIDER_PRESENTATION, provider)
	) {
		return AI_PROVIDER_PRESENTATION[
			provider as AIProviderId
		];
	}
	return AI_FALLBACK_PRESENTATION;
}
