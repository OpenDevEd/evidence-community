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
import { and, desc, eq, gt, or } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm";
import { sql } from "drizzle-orm";

const embeddingModel = openai.embedding("text-embedding-3-small");

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
		largeModel: model.largeModel,
		smallModel: model.smallModel,
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

export const createResource = async (item: NonNullable<Item["fullTextPDFs"]>[0], parentKey: string) => {
	try {
		const existingEmbeddings = await db.select().from(embeddings).where(eq(embeddings.itemKey, item.key)).limit(1);
		const embeddingsAlreadyExistOrItemHasNoPDFs = item.fullTextPDF.length === 0 || existingEmbeddings.length > 0;
		if (embeddingsAlreadyExistOrItemHasNoPDFs) {
			console.log("Embeddings already exist for this item.", item.key);
			return "Embeddings already exist for this item.";
		}

		let totalChunks = 0;
		let insertedChunks = 0;

		const allPDFPromises = item.fullTextPDF.map(async (page) => {
			const embeddings = await generateEmbeddings(page.text);
			totalChunks += embeddings.length;
			const insertion = await db.insert(embeddingsTable).values(
				embeddings.map((embedding) => ({
					content: embedding.content,
					page: page.page,
					embedding: embedding.embedding,
					itemKey: item.key,
					parentKey: parentKey,
				}))
			);
			insertedChunks += embeddings.length;
			console.log("Inserted", embeddings.length, "embeddings for", item.key, `(${insertedChunks}/${totalChunks})`);
			return insertion;
		});


		const results = await Promise.allSettled(allPDFPromises);

		console.log("Inserted", insertedChunks, "embeddings for", item.key, `(${insertedChunks}/${totalChunks})`);

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

export interface RAGResult {
	name: string; // This is the content snippet
	similarity: number;
	page: number;
	parentKey: string | null;
	url?: string; // Optional, as per your function's output
}

export const findRelevantContent = async (
	userQuery: string,
	itemKey: string | null,
	userSpecifiedPage: number,
): Promise<RAGResult[]> => {
	if (!itemKey) {
		console.warn("findRelevantContent called without an itemKey. Returning empty.");
		return [];
	}
	const userQueryEmbedded = await generateEmbedding(userQuery);
	const similarity = sql<number>`1 - (${cosineDistance(
		embeddings.embedding,
		userQueryEmbedded,
	)})`;

	const conditions = [
		gt(similarity, 0.3), // Added a minimum similarity threshold, adjust as needed
		or(eq(embeddings.parentKey, itemKey), eq(embeddings.itemKey, itemKey)),
	];

	if (userSpecifiedPage !== 0) {
		conditions.push(eq(embeddings.page, userSpecifiedPage));
	}

	const whereCondition = and(...conditions.filter(Boolean));

	// Ensure your actual db query is typed correctly if possible
	const similarGuidesFromDb = await db
		.select({
			name: embeddings.content,
			similarity,
			page: embeddings.page,
			parentKey: embeddings.parentKey,
		})
		.from(embeddings)
		.where(whereCondition)
		.orderBy((t: any) => desc(t.similarity)) // t might need specific typing from your ORM
		.limit(10); // Reduced limit for agent processing, adjust as needed

	return similarGuidesFromDb.map((guide: any) => ({
		...guide,
		url: process.env.BASE_URL + `/lib/${guide.parentKey}`,
	}));
};