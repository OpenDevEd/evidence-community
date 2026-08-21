import { extractAIErrorMessage } from "./error-message";

export function clientAIError(error: Error) {
	return new Error(extractAIErrorMessage(error) ?? error.message);
}
