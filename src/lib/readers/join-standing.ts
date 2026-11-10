import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { adminRoleOf } from "@/lib/admin/access";

import { parseJoinStanding, type JoinStanding } from "./join";

/** OpenScholar decides who may apply; an answer is reused for about a minute, as a reader's role is (../admin/access.ts). */
const JOIN_STANDING_CACHE_MS = 60_000;
const answers = new Map<string, { join: JoinStanding; expiresAt: number }>();

/**
 * Where a reader stands with joining this community's team, or where anyone does when none is signed in, as OpenScholar
 * says (`POST /api/v1/evidence-libraries/join-standing`). `fresh` asks again now, for a reader coming back from
 * applying. When OpenScholar can't be asked, its last answer stands, and with none Join stays offered: its page there
 * says where the reader stands.
 */
export async function joinStandingOf(config: LibraryServerConfig, clerkUserId: string | null, { fresh = false } = {}): Promise<JoinStanding> {
	const { convexSiteUrl, libraryId, machineCredential } = config.authentication.openScholar;
	const key = `${libraryId}:${clerkUserId ?? ""}`;
	const cached = answers.get(key);
	if (!fresh && cached && cached.expiresAt > Date.now()) return cached.join;
	try {
		const response = await fetch(new URL("/api/v1/evidence-libraries/join-standing", convexSiteUrl), {
			method: "POST",
			cache: "no-store",
			// Every page waits on this for a signed-out visitor once a minute, so it gives up soon.
			signal: AbortSignal.timeout(3_000),
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${machineCredential}`, "OpenScholar-Contract": "1" },
			body: JSON.stringify({ libraryId, ...(clerkUserId ? { clerkUserId } : {}) }),
		});
		if (!response.ok) throw new Error(`OpenScholar answered ${response.status}`);
		const join = parseJoinStanding(((await response.json()) as { join?: unknown }).join);
		answers.set(key, { join, expiresAt: Date.now() + JOIN_STANDING_CACHE_MS });
		return join;
	} catch (error) {
		console.error("Join standing unavailable", { libraryId, reader: clerkUserId !== null, error: String(error) });
		return cached?.join ?? "open";
	}
}

/**
 * Where someone stands with this community's team, as its pages show it: `admin` with a role above viewer, and
 * otherwise whether Join this team leads somewhere for them. The team's own have Admin in Join's place, so nothing is
 * asked about joining for them. `reader` is null for a visitor who isn't signed in.
 */
export async function teamStandingOf(config: LibraryServerConfig, reader: { clerkUserId: string } | null, options?: { fresh?: boolean }) {
	const clerkUserId = reader ? reader.clerkUserId : null;
	const admin = clerkUserId !== null && (await adminRoleOf(config, clerkUserId)) !== null;
	const join: JoinStanding = admin ? "open" : await joinStandingOf(config, clerkUserId, options);
	return { admin, join };
}
