import { DrizzleQueryError } from "drizzle-orm";
import {
	AI_CONTEXT_TOO_LARGE_MESSAGE,
	extractAIErrorMessage,
	extractAIErrorType,
} from "./error-message";

export type AIErrorCode =
	| "AI_DISABLED"
	| "CONTEXT_TOO_LARGE"
	| "DOCUMENT_TOO_LARGE"
	| "INVALID_REQUEST"
	| "ITEM_NOT_FOUND"
	| "LIBRARY_UNAVAILABLE"
	| "MODEL_UNAVAILABLE"
	| "PROVIDER_ERROR"
	| "RATE_LIMITED";

export class AIError extends Error {
	constructor(
		public readonly code: AIErrorCode,
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "AIError";
	}
}

type AIErrorContext = "conversation" | "document" | "request";

export function normalizeAIError(
	error: unknown,
	options: { context?: AIErrorContext } = {},
): AIError {
	if (error instanceof AIError) return error;
	// The library's own database failed, before or after the model: no provider was involved.
	if (error instanceof DrizzleQueryError) {
		return new AIError(
			"LIBRARY_UNAVAILABLE",
			"The community couldn't read its records just now. Try again in a moment.",
			503,
		);
	}

	const message =
		extractAIErrorMessage(error) ??
		"The provider returned an unknown error.";
	const text = message.toLowerCase();
	const providerErrorType = extractAIErrorType(error)?.toLowerCase();
	const isContextOverflow =
		providerErrorType === "context_length_exceeded" ||
		text.includes("context length") ||
		text.includes("maximum context");

	if (isContextOverflow) {
		if (options.context === "document") {
			return new AIError(
				"DOCUMENT_TOO_LARGE",
				"The attached document exceeds this model's context limit.",
				413,
			);
		}

		return new AIError(
			"CONTEXT_TOO_LARGE",
			options.context === "conversation"
				? AI_CONTEXT_TOO_LARGE_MESSAGE
				: "This request contains too much context for the selected model.",
			400,
		);
	}

	if (
		providerErrorType === "payload_too_large" ||
		providerErrorType === "string_too_long" ||
		text.includes("payload too large") ||
		text.includes("file too large") ||
		text.includes("request too large")
	) {
		return new AIError(
			"DOCUMENT_TOO_LARGE",
			"The attached document exceeds this model's limits.",
			413,
		);
	}

	const status = extractAIErrorStatus(error);
	if (status === 502 || status === 413 || /bad gateway/i.test(text)) {
		return new AIError(
			"PROVIDER_ERROR",
			"The AI provider rejected this request at its gateway. This usually happens when too many or very large PDFs are attached; try again with fewer publications.",
			502,
		);
	}

	return new AIError(
		"PROVIDER_ERROR",
		`The AI provider could not complete this request: ${message}`,
		502,
	);
}

function extractAIErrorStatus(error: unknown, depth = 0): number | undefined {
	if (!error || typeof error !== "object" || depth > 5) return undefined;
	const record = error as {
		statusCode?: unknown;
		status?: unknown;
		lastError?: unknown;
		cause?: unknown;
	};
	for (const candidate of [record.statusCode, record.status]) {
		if (typeof candidate === "number") return candidate;
	}
	return (
		extractAIErrorStatus(record.lastError, depth + 1) ??
		extractAIErrorStatus(record.cause, depth + 1)
	);
}

export function aiErrorResponse(
	error: unknown,
	options: { context?: AIErrorContext } = {},
) {
	console.error("[AI request failed]", error);
	const normalized = normalizeAIError(error, options);
	// A plain Response, so the publication worker, which reads PDFs with the library's model, needs nothing from Next.
	return Response.json(
		{
			error: {
				code: normalized.code,
				message: normalized.message,
			},
		},
		{ status: normalized.status },
	);
}

function describeError(error: unknown, depth = 0): Record<string, unknown> {
	if (!(error instanceof Error)) return { value: String(error) };
	const record = error as Error & {
		code?: unknown;
		status?: unknown;
		statusCode?: unknown;
		cause?: unknown;
		responseBody?: unknown;
	};
	return {
		name: record.name,
		message: record.message,
		code: record.code,
		status: record.status ?? record.statusCode,
		responseBody:
			typeof record.responseBody === "string"
				? record.responseBody.slice(0, 2000)
				: undefined,
		stack: record.stack?.split("\n").slice(0, 8).join("\n"),
		cause:
			record.cause !== undefined && depth < 5
				? describeError(record.cause, depth + 1)
				: undefined,
	};
}

export function aiStreamErrorMessage(
	error: unknown,
	options: { context?: AIErrorContext } = {},
): string {
	console.error(
		"[AI stream failed]",
		JSON.stringify(describeError(error), null, 2),
	);
	return normalizeAIError(error, options).message;
}
