import { z } from "zod";
import { areLinksValid } from "./actions";

// The contact and takedown forms' rules, apart from the shared helpers so pages without a form do not load zod.
export const contactRequestSchema = z.object({
	email: z.string().email(),
	description: z.string().trim().min(20),
});

export const takedownRequestSchema = contactRequestSchema.extend({
	links: z.array(z.string().trim().url()).min(1),
});

export async function validateTakedownRequest(email: string, links: string[], description: string): Promise<{ error: string } | { success: boolean }> {
	const result = takedownRequestSchema.safeParse({ email, links, description });
	if (!result.success) {
		return { error: result.error.message };
	}

	const linksValid = await areLinksValid(result.data.links);
	if (!linksValid.every((result) => result.status === "fulfilled" && result.value)) {
		return { error: "Invalid links" };
	}

	return { success: true };
}

export async function validateContactRequest(email: string, description: string): Promise<{ error: string } | { success: boolean }> {
	const result = contactRequestSchema.safeParse({ email, description });
	if (!result.success) {
		return { error: result.error.message };
	}

	return { success: true };
}
