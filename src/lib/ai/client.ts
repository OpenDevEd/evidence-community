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
	const message = extractAIErrorMessage(error);
	const isHtmlPage = /<(?:!doctype\s+html|html|head|body)\b/iu.test(message ?? "");
	return new Error(message && !isHtmlPage ? message : "The AI service is temporarily unavailable. Please try again.");
}
