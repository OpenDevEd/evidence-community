import type { UIMessage } from "ai";
import { extractAIErrorMessage } from "./error-message";

export function uiMessageText(message: UIMessage | undefined) {
	return (
		message?.parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("") ?? ""
	);
}

export function uiMessageReasoningText(message: UIMessage | undefined) {
	return (
		message?.parts
			.filter((part) => part.type === "reasoning")
			.map((part) => part.text)
			.join("\n\n") ?? ""
	);
}

export function clientAIError(error: Error) {
	return new Error(extractAIErrorMessage(error) ?? error.message);
}
