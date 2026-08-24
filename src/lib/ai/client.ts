import { extractAIErrorMessage } from "./error-message";

/** The plain sentence behind a coded AI failure, for the chat to show. */
export function clientAIError(error: Error) {
	return new Error(extractAIErrorMessage(error) ?? error.message);
}
