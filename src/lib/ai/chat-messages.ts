import type { ResearchUIMessage } from "@/lib/ai/agent";
import {
	type createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextPart,
	researchRequestContextsEqual,
	type ResearchRequestContextSnapshot,
} from "@/lib/ai/request-context";

/**
 * The parts one question is made of: what the reader was looking at, added
 * only when it changed since the assistant last saw it, then the question.
 */
export function researchMessageParts(
	messages: ResearchUIMessage[],
	context: ResearchRequestContextSnapshot,
	text: string,
): ResearchUIMessage["parts"] {
	const parts: ResearchUIMessage["parts"] = [];
	if (
		!researchRequestContextsEqual(
			latestResearchRequestContext(messages),
			context,
		)
	) {
		parts.push(researchRequestContextPart(context));
	}
	parts.push({ type: "text", text });

	return parts;
}

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
