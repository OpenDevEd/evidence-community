import { NextResponse } from "next/server";
import { z } from "zod";
import { getCachedStatus } from "@/app/api/cache";
import { AIError, aiErrorResponse, normalizeAIError } from "@/lib/ai/errors";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { isFeatureFlagEnabled } from "@/lib/feature-flags";
import { TRANSLATION_MODEL_ID, translateRecords } from "@/lib/record-translation";
import { getServerAnalyticsContext, type ServerAnalyticsContext } from "@/lib/server-analytics";
import { getServerFeatureFlags } from "@/lib/server-feature-flags";
import {
	ABSTRACTS_PER_REQUEST,
	TITLES_PER_REQUEST,
	TRANSLATION_LANGUAGE_CODES,
} from "@/lib/translation-languages";

export const maxDuration = 120;

const bodySchema = z
	.object({
		part: z.enum(["title", "abstract"]),
		language: z.enum(TRANSLATION_LANGUAGE_CODES),
		keys: z.array(z.string().trim().min(1).max(64)).min(1).max(TITLES_PER_REQUEST),
		distinctId: z.string().trim().min(1).max(200).optional(),
	})
	.refine(({ part, keys }) => part === "title" || keys.length <= ABSTRACTS_PER_REQUEST);

/** Records' titles or abstracts in one language, from the stored translations or made now. */
export async function POST(request: Request) {
	const startedAt = Date.now();
	let analyticsContext: ServerAnalyticsContext = { mode: "aggregate" };
	try {
		const body = bodySchema.safeParse(await request.json().catch(() => null));
		if (!body.success) throw new AIError("INVALID_REQUEST", "Invalid translation request.", 400);
		analyticsContext = getServerAnalyticsContext(request, body.data.distinctId);
		const flags = getServerFeatureFlags((await getCachedStatus()).companyFooter);
		if (!isFeatureFlagEnabled(flags, "ai-translation")) {
			throw new AIError("AI_DISABLED", "Translation is not enabled for this library.", 403);
		}

		const { part, language, keys } = body.data;
		const { translations, model } = await translateRecords(part, language, [...new Set(keys)]);
		if (model) {
			trackAIUsage({
				analyticsContext,
				feature: "translation",
				modelId: TRANSLATION_MODEL_ID,
				startedAt,
				success: true,
				usage: model.usage,
				providerMetadata: model.providerMetadata,
				responseHeaders: model.response.headers,
			});
		}
		return NextResponse.json({ translations }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		const normalized = normalizeAIError(error);
		trackAIUsage({
			analyticsContext,
			feature: "translation",
			modelId: TRANSLATION_MODEL_ID,
			startedAt,
			success: false,
			errorCode: normalized.code,
		});
		return aiErrorResponse(error);
	}
}
