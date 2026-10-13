import "server-only";

import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";

import type { OpenScholarHandoff } from "./handoff";

const REQUEST_TIMEOUT_MS = 10_000;
const answerSchema = z.object({ handoffId: z.string(), url: z.url(), expiresAt: z.number() });

/**
 * Makes the hand-off at OpenScholar with this library's machine credential, and answers where to send the reader.
 * The reader's Clerk user ID only says who asked, in OpenScholar's logs.
 */
export async function createOpenScholarHandoff(config: LibraryServerConfig, handoff: OpenScholarHandoff, clerkUserId: string | null) {
	const { convexSiteUrl, libraryId, machineCredential } = config.authentication.openScholar;
	const response = await fetch(new URL("/api/v1/evidence-libraries/handoffs", convexSiteUrl), {
		method: "POST",
		cache: "no-store",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${machineCredential}`, "OpenScholar-Contract": "1" },
		body: JSON.stringify({ libraryId, ...(clerkUserId ? { clerkUserId } : {}), ...handoff }),
	});
	if (response.status !== 201) {
		const body = (await response.text().catch(() => "")).slice(0, 500);
		console.warn("[library sources] OpenScholar refused a hand-off", { libraryId, clerkUserId, from: handoff.from, status: response.status, body });
		throw new Error(`OpenScholar answered HTTP ${response.status} to a hand-off`);
	}
	return answerSchema.parse(await response.json()).url;
}
