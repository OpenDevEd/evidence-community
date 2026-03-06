import { z } from "zod";

export const collectionFieldsSchema = z.object({
	name: z.string().min(1).max(24),
	description: z.string().min(0).max(200).optional(),
});

export const createCollectionSchema = collectionFieldsSchema.extend({
	private: z.boolean(),
});
