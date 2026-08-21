const ERROR_MESSAGE_KEYS = [
	"message",
	"error",
	"detail",
	"details",
	"msg",
	"responseBody",
	"data",
	"cause",
] as const;

const ERROR_TYPE_CONTAINER_KEYS = [
	"error",
	"metadata",
	"responseBody",
	"data",
	"cause",
] as const;

export const AI_CONTEXT_TOO_LARGE_MESSAGE =
	"This conversation is too long for the selected model. Reset the chat to continue.";

function usefulMessage(value: string) {
	const message = value.trim();
	return message && message !== "[object Object]" ? message : null;
}

export function extractAIErrorMessage(
	error: unknown,
	seen = new Set<object>(),
): string | null {
	if (typeof error === "string") {
		const message = usefulMessage(error);
		if (!message) return null;

		try {
			return extractAIErrorMessage(JSON.parse(message), seen) ?? message;
		} catch {
			return message;
		}
	}

	if (!error || typeof error !== "object" || seen.has(error)) return null;
	seen.add(error);

	for (const key of ERROR_MESSAGE_KEYS) {
		if (!(key in error)) continue;
		const message = extractAIErrorMessage(
			Reflect.get(error, key) as unknown,
			seen,
		);
		if (message) return message;
	}

	if (error instanceof Error) {
		return usefulMessage(error.message);
	}

	return null;
}

export function extractAIErrorType(
	error: unknown,
	seen = new Set<object>(),
): string | null {
	if (typeof error === "string") {
		try {
			return extractAIErrorType(JSON.parse(error), seen);
		} catch {
			return null;
		}
	}

	if (!error || typeof error !== "object" || seen.has(error)) return null;
	seen.add(error);

	for (const key of ["error_type", "errorType"] as const) {
		const value = Reflect.get(error, key) as unknown;
		if (typeof value === "string" && value.trim()) return value.trim();
	}

	for (const key of ERROR_TYPE_CONTAINER_KEYS) {
		if (!(key in error)) continue;
		const type = extractAIErrorType(
			Reflect.get(error, key) as unknown,
			seen,
		);
		if (type) return type;
	}

	return null;
}
