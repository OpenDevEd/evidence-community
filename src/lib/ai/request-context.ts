import {
	librarySearchContextSchema,
	librarySearchContextSummary,
	type LibrarySearchContext,
} from "@/lib/search-context";
import { z } from "zod";
import { currentDateContext } from "./prompt-context";

/** What a publication with no title is called in what a question is about; the server checks the same words. */
export const UNTITLED_PUBLICATION = "Untitled publication";

const currentPublicationSchema = z
	.object({
		key: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.regex(/^[A-Za-z0-9:_-]+$/),
		title: z.string().trim().min(1).max(2_000),
	})
	.strict();

export const researchRequestContextSnapshotSchema = z
	.object({
		currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		currentPublication: currentPublicationSchema.nullable(),
		searchContext: librarySearchContextSchema.nullable(),
	})
	.strict();

export type ResearchRequestContextSnapshot = z.infer<
	typeof researchRequestContextSnapshotSchema
>;

/** The data parts a chat message may carry alongside its text. */
export type ResearchUIData = {
	requestContext: ResearchRequestContextSnapshot;
};

export function createResearchRequestContextSnapshot({
	currentPublication,
	searchContext,
	now = new Date(),
}: {
	currentPublication?: { key: string; title: string };
	searchContext?: LibrarySearchContext;
	now?: Date;
}): ResearchRequestContextSnapshot {
	return researchRequestContextSnapshotSchema.parse({
		currentDate: now.toISOString().slice(0, 10),
		currentPublication: currentPublication ?? null,
		searchContext: searchContext ?? null,
	});
}

export function researchRequestContextsEqual(
	left: ResearchRequestContextSnapshot | undefined,
	right: ResearchRequestContextSnapshot,
) {
	return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The publication each of the reader's questions was asked about. A question
 * carries its context only when it changed, so the last one seen before it
 * stands for the questions that follow.
 */
export function publicationsAsked(
	messages: ReadonlyArray<{ id: string; role: string; parts: ReadonlyArray<{ type: string; data?: unknown }> }>,
) {
	const asked = new Map<string, { key: string; title: string }>();
	let current: { key: string; title: string } | null = null;
	for (const message of messages) {
		const context = latestResearchRequestContext([message]);
		if (context) current = context.currentPublication;
		if (message.role === "user" && current) asked.set(message.id, current);
	}
	return asked;
}

export function latestResearchRequestContext(
	messages: ReadonlyArray<{
		parts: ReadonlyArray<{ type: string; data?: unknown }>;
	}>,
) {
	for (
		let messageIndex = messages.length - 1;
		messageIndex >= 0;
		messageIndex -= 1
	) {
		const message = messages[messageIndex];
		for (
			let partIndex = message.parts.length - 1;
			partIndex >= 0;
			partIndex -= 1
		) {
			const part = message.parts[partIndex];
			if (part.type !== "data-requestContext") continue;
			const parsed = researchRequestContextSnapshotSchema.safeParse(
				part.data,
			);
			if (parsed.success) return parsed.data;
		}
	}
	return undefined;
}

export function researchRequestContextPart(
	context: ResearchRequestContextSnapshot,
) {
	return {
		type: "data-requestContext" as const,
		data: context,
	};
}

export function researchRequestContextText(
	context: ResearchRequestContextSnapshot,
) {
	return [
		"<request_context>",
		currentDateContext(
			new Date(`${context.currentDate}T00:00:00.000Z`),
		),
		context.currentPublication
			? `Current publication: ${JSON.stringify(context.currentPublication)}.`
			: "There is no current publication.",
		context.searchContext
			? `Current community result set: <current-library-search>${librarySearchContextSummary(context.searchContext)}</current-library-search>.`
			: "There is no current community result set.",
		"</request_context>",
	].join("\n");
}
