import { sanitizeAnalyticsPath } from "@/lib/analytics-shared";
import { z } from "zod";

const pageViewEventSchema = z
	.object({
		event: z.literal("page_view"),
		properties: z
			.object({
				pagePath: z.string().trim().min(1).max(500),
			})
			.strict(),
	})
	.strict();

const attachmentEventSchema = z
	.object({
		event: z.literal("attachment_interaction"),
		properties: z
			.object({
				action: z.enum(["view", "download", "open"]),
				source: z.enum(["internal", "external"]),
				parentType: z.string().trim().min(1).max(80),
				locale: z.string().trim().min(2).max(20),
				isAuthenticated: z.boolean(),
			})
			.strict(),
	})
	.strict();

const libraryResultsEventSchema = z
	.object({
		event: z.literal("library_results_loaded"),
		properties: z
			.object({
				has_search: z.boolean(),
				filter_count: z.number().int().min(0).max(500),
				page: z.number().int().min(1).max(100_000),
				page_result_count: z.number().int().min(0).max(500),
				total_result_count: z.number().int().min(0).max(10_000_000),
				scope: z.string().trim().min(1).max(80),
				sort: z.string().trim().min(1).max(80),
			})
			.strict(),
	})
	.strict();

const contentActionEventSchema = z
	.object({
		event: z.literal("content_action"),
		properties: z
			.object({
				action: z.enum(["copy", "download"]),
				context: z.enum([
					"ai_response",
					"chat_transcript",
					"generated_content",
					"library_records",
					"smart_screening",
				]),
				format: z.string().trim().min(1).max(30),
			})
			.strict(),
	})
	.strict();

export const aggregateAnalyticsEventSchema = z.discriminatedUnion("event", [
	pageViewEventSchema,
	attachmentEventSchema,
	libraryResultsEventSchema,
	contentActionEventSchema,
]);

export type AggregateAnalyticsEvent = z.infer<
	typeof aggregateAnalyticsEventSchema
>;

export function normalizeAggregateAnalyticsProperties(
	payload: AggregateAnalyticsEvent,
): Record<string, unknown> {
	if (payload.event === "page_view") {
		return {
			page_path: sanitizeAnalyticsPath(payload.properties.pagePath),
		};
	}

	if (payload.event === "attachment_interaction") {
		return {
			action: payload.properties.action,
			source: payload.properties.source,
			parent_type: payload.properties.parentType,
			locale: payload.properties.locale,
			is_authenticated: payload.properties.isAuthenticated,
		};
	}

	return payload.properties;
}
