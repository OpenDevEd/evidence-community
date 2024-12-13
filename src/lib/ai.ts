import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { models } from "@/constants/ai";

export const providers = [
    openai,
    google,
    anthropic
]

export function getModel(modelIndex: number) {
    const model = models[modelIndex];

	if (!model) {
		return { error: "Model not found" };
	}

	const provider = providers[modelIndex];

	if (!provider) {
		return { error: "Provider not found" };
	}

	const modelName = model.model;

	if (!modelName) {
		return { error: "Model name not found" };
	}

    return {
        provider,
        modelName
    }
}