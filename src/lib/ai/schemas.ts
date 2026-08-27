import { z } from "zod";
import { librarySearchContextSchema } from "@/lib/search-context";
import { isAIModelId, type AIModelId } from "./models";

export const aiModelIdSchema = z.custom<AIModelId>(isAIModelId, {
	message: "Unsupported AI model",
});

const distinctIdSchema = z.string().trim().min(1).max(200).optional();
const itemKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.regex(/^[A-Za-z0-9:_-]+$/);

export const SMART_SCREENING_LIMITS = {
	items: 25,
	fields: 20,
	labelCharacters: 120,
	descriptionCharacters: {
		min: 20,
		max: 1000,
	},
} as const;

export const publicationGenerationSchema = z
	.object({
		prompt: itemKeySchema,
		feature: z.enum(["summarize", "explain"]),
		modelId: aiModelIdSchema,
		distinctId: distinctIdSchema,
	})
	.strict();

export const starterQuestionsSchema = z
	.object({
		prompt: itemKeySchema,
		distinctId: distinctIdSchema,
	})
	.strict();

export const chatRequestSchema = z
	.object({
		id: z.string().trim().min(1).max(200),
		messages: z.array(z.unknown()).min(1).max(100),
		trigger: z.enum(["submit-message", "regenerate-message"]),
		messageId: z.string().trim().min(1).max(200).optional(),
		modelId: aiModelIdSchema,
		distinctId: distinctIdSchema,
		itemKey: itemKeySchema.optional(),
		mode: z.enum(["quick", "research"]),
		searchContext: librarySearchContextSchema.optional(),
	})
	.strict();

export const smartScreeningFieldSchema = z
	.object({
		label: z
			.string()
			.trim()
			.min(1)
			.max(SMART_SCREENING_LIMITS.labelCharacters),
		description: z
			.string()
			.trim()
			.min(SMART_SCREENING_LIMITS.descriptionCharacters.min)
			.max(SMART_SCREENING_LIMITS.descriptionCharacters.max),
		type: z.enum(["string", "number", "boolean"]),
	})
	.strict();

export const screeningRequestSchema = z
	.object({
		keys: z.array(itemKeySchema).min(1).max(SMART_SCREENING_LIMITS.items),
		modelId: aiModelIdSchema,
		distinctId: distinctIdSchema,
		fields: z
			.array(smartScreeningFieldSchema)
			.min(1)
			.max(SMART_SCREENING_LIMITS.fields),
	})
	.strict()
	.refine(
		({ fields }) =>
			new Set(fields.map(({ label }) => label.toLowerCase())).size ===
			fields.length,
		{
			message: "Screening field labels must be unique",
			path: ["fields"],
		},
	);
