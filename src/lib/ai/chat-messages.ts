import type { ResearchUIMessage } from "@/lib/ai/agent";
import {
	type createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextPart,
	researchRequestContextsEqual,
} from "@/lib/ai/request-context";

/** Builds a plain message with one block of text in it. */
export function createTextMessage(
	role: "user" | "assistant",
	content: string,
	id: string,
): ResearchUIMessage {
	return {
		id,
		role,
		parts: [{ type: "text", text: content }],
	} as ResearchUIMessage;
}

/**
 * Records what the reader was looking at when they asked. Nothing is added
 * when the newest question already carries the same context.
 */
export function withLatestRequestContext(
	messages: ResearchUIMessage[],
	context: ReturnType<typeof createResearchRequestContextSnapshot>,
): ResearchUIMessage[] {
	if (
		researchRequestContextsEqual(
			latestResearchRequestContext(messages),
			context,
		)
	) {
		return messages;
	}

	const messageIndex = messages.findLastIndex(({ role }) => role === "user");
	if (messageIndex < 0) return messages;

	const updated = [...messages];
	updated[messageIndex] = {
		...updated[messageIndex],
		parts: [
			...updated[messageIndex].parts,
			researchRequestContextPart(context),
		],
	};

	return updated;
}
