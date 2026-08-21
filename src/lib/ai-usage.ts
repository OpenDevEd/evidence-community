import "server-only";

import { getPostHogForConfig } from "./posthog";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export async function trackUsage(
	config: LibraryServerConfig,
	eventName: string,
	event: any,
	distinctId: string | null | undefined,
	prompt: string
) {
	if (!distinctId) {
		return;
	}

	try {
		const posthogClient = await getPostHogForConfig(config);
		if (!posthogClient) {
			return;
		}

		const modelName = event.response.modelId;

		posthogClient.capture({
			event: eventName,
			distinctId,
			properties: {
				model: modelName,
				prompt,
				prompt_tokens: event.usage?.promptTokens,
				completion_tokens: event.usage?.completionTokens,
				total_tokens: event.usage?.totalTokens,
			},
		});
	} catch (error) {
		console.error("Failed to record AI usage analytics", error);
	}
}
