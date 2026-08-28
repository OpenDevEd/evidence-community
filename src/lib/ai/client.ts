import type { UIMessage } from "ai";
import { extractAIErrorMessage } from "./error-message";

/** The words in a message, with everything else left out. */
export function uiMessageText(message: UIMessage | undefined) {
	return (
		message?.parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("") ?? ""
	);
}

/** The plain sentence behind a coded AI failure, for the chat to show. */
export function clientAIError(error: Error) {
	return new Error(extractAIErrorMessage(error) ?? error.message);
}
