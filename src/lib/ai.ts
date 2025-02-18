import "server-only";

import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { mistral } from "@ai-sdk/mistral";
import { deepseek } from "@ai-sdk/deepseek";
import { models, pricings } from "@/constants/ai";
import posthogClient from "./posthog";
import { embed, embedMany } from "ai";
import { Item } from "@/app/api/item/types";
import { db } from "@/db";
import { embeddings, embeddings as embeddingsTable } from "@/db/schema/tables/embeddings";
import { and, desc, eq, gt } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm";
import { sql } from "drizzle-orm";

const embeddingModel = openai.embedding("text-embedding-ada-002");

export const providers = [google, openai, deepseek, anthropic, mistral];

export function getModel(modelIndex: number) {
	const model = models[modelIndex];

	if (!model) {
		return { error: "Model not found" };
	}

	const provider = providers[modelIndex];

	if (!provider) {
		return { error: "Provider not found" };
	}

	const modelName = model.model;

	if (!modelName) {
		return { error: "Model name not found" };
	}

	return {
		provider,
		modelName,
	};
}

export function trackUsage(
	eventName: string,
	event: any,
	distinctId: string,
	prompt: string
) {
	const modelName = event.response.modelId;
	let costs = pricings[modelName as keyof typeof pricings];
	if (!costs) {
		costs = pricings["gpt-4o-mini"];
	}
	const input_cost_in_dollars = costs.input * event.usage?.promptTokens;
	const output_cost_in_dollars = costs.output * event.usage?.completionTokens;

	posthogClient.capture({
		event: eventName,
		distinctId: distinctId,
		properties: {
			model: modelName,
			prompt: prompt,
			prompt_tokens: event.usage?.promptTokens,
			completion_tokens: event.usage?.completionTokens,
			total_tokens: event.usage?.totalTokens,
			input_cost_in_dollars: input_cost_in_dollars,
			output_cost_in_dollars: output_cost_in_dollars,
			total_cost_in_dollars:
				input_cost_in_dollars + output_cost_in_dollars,
		},
	});
}

const generateChunks = (input: string): string[] => {
	return input
		.trim()
		.split(".")
		.filter((i) => i !== "");
};

export const generateEmbeddings = async (
	value: string
): Promise<Array<{ embedding: number[]; content: string }>> => {
	const chunks = generateChunks(value);
	const { embeddings } = await embedMany({
		model: embeddingModel,
		values: chunks,
	});
	return embeddings.map((e, i) => ({ content: chunks[i], embedding: e }));
};

export const createResource = async (item: Item) => {
	try {
		const itemKey = item.key;

		const existingEmbeddings = await db.select().from(embeddings).where(eq(embeddings.itemKey, itemKey)).limit(1);
		const embeddingsAlreadyExistOrItemHasNoPDFs = item.fullTextPDFs?.length === 0 || existingEmbeddings.length > 0;
		if (embeddingsAlreadyExistOrItemHasNoPDFs) {
			return "Embeddings already exist for this item.";
		}

		const fullTextPDF = item.fullTextPDFs;

		const allPDFPromises = (fullTextPDF || []).flatMap((pdf) =>
			pdf.fullTextPDF.map(async (page) => {
				const embeddings = await generateEmbeddings(page.text);
				return db.insert(embeddingsTable).values(
					embeddings.map((embedding) => ({
						content: embedding.content,
						page: page.page,
						embedding: embedding.embedding,
						itemKey: item.key,
					}))
				);
			})
		);

		const results = await Promise.allSettled(allPDFPromises);

		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				console.error(`Failed to process document ${index}:`, result.reason);
			}
		});

		return "Resource successfully created and embedded.";
	} catch (error) {
		return error instanceof Error && error.message.length > 0
			? error.message
			: "Error, please try again.";
	}
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
	const input = value.replaceAll('\\n', ' ');
	const { embedding } = await embed({
		model: embeddingModel,
		value: input,
	});
	return embedding;
};

export const findRelevantContent = async (userQuery: string, itemKey: string | null, userSpecifiedPage: number) => {
	const userQueryEmbedded = await generateEmbedding(userQuery);
	const similarity = sql<number>`1 - (${cosineDistance(
		embeddings.embedding,
		userQueryEmbedded,
	)})`;
	
	const baseCondition = [
		gt(similarity, 0.5),
		itemKey ? eq(embeddings.parentKey, itemKey) : undefined,
		userSpecifiedPage !== 0 ? eq(embeddings.page, userSpecifiedPage) : undefined,
	].filter(Boolean);
	const whereCondition = and(...baseCondition);

	const similarGuides = await db
		.select({ name: embeddings.content, similarity, page: embeddings.page, itemKey: embeddings.itemKey, parentKey: embeddings.parentKey })
		.from(embeddings)
		.where(whereCondition)
		.orderBy(t => desc(t.similarity))
		.limit(100);
	
	return similarGuides.map(guide => ({
		...guide,
		url: process.env.BASE_URL + `/lib/${guide.parentKey}`,
	}));
};