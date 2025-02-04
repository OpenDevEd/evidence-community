import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { mistral } from "@ai-sdk/mistral";
import { deepseek } from "@ai-sdk/deepseek";
import { models, pricings } from "@/constants/ai";
import posthogClient from "./posthog";

export const providers = [google, openai, anthropic, mistral, deepseek];

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
		modelName,
	};
}

export function trackUsage(eventName: string, event: any, distinctId: string, prompt: string) {
	const modelName = event.response.modelId;
	let costs = pricings[modelName as keyof typeof pricings];
	if (!costs) {
		costs = pricings["gpt-4o-mini"];
	}
	const input_cost_in_dollars = costs.input * event.usage?.promptTokens;
	const output_cost_in_dollars = costs.output * event.usage?.completionTokens;

	posthogClient.capture({
		event: eventName,
		distinctId: distinctId,
		properties: {
			model: modelName,
			prompt: prompt,
			prompt_tokens: event.usage?.promptTokens,
			completion_tokens: event.usage?.completionTokens,
			total_tokens: event.usage?.totalTokens,
			input_cost_in_dollars: input_cost_in_dollars,
			output_cost_in_dollars: output_cost_in_dollars,
			total_cost_in_dollars:
				input_cost_in_dollars + output_cost_in_dollars,
		},
	});
}
