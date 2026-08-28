import type { ZodType } from "zod";

import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { loadPublication } from "@/lib/ai/attachments";
import { AIError } from "@/lib/ai/errors";
import { resolveAIModel } from "@/lib/ai/model-resolution";

/**
 * The opening every publication route shares: the library must have AI
 * switched on, and the request must match its schema before anything runs.
 */
export async function readAIRequest<T>(
	request: Request,
	schema: ZodType<T>,
) {
	const config = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(config.features, "ai")) {
		throw new AIError("AI_DISABLED", "AI is disabled", 403);
	}

	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		throw new AIError("INVALID_REQUEST", "Invalid AI request.", 400);
	}

	return { config, request: parsed.data };
}

/**
 * Everything a publication request needs: the model the reader picked, and
 * the publication with every PDF they can see already attached.
 */
export async function loadSelectedPublication(
	config: Pick<
		LibraryServerConfig,
		"ai" | "revision" | "updatedAt"
	>,
	{ itemKey, modelId }: { itemKey: string; modelId: unknown },
) {
	const selectedModel = await resolveAIModel(config, modelId);
	const publication = await loadPublication(itemKey);
	if (!publication) {
		throw new AIError("ITEM_NOT_FOUND", "Item not found.", 404);
	}

	return { publication, selectedModel };
}
