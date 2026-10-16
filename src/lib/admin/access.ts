import "server-only";

import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

import {
	adminRoleSchema,
	adminRoleHasPermission,
	type AdminPermission,
	type AdminRole,
} from "./permissions";

export {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	ADMIN_LIBRARY_PERMISSION,
	adminRoleHasPermission,
	type AdminPermission,
} from "./permissions";

/** Who is acting in /admin: their OpenScholar account and role, with their name and photo as their account has them now. */
export type AdminSession = { clerkUserId: string; role: AdminRole; name: string; image: string | null };

export type AdminSessionAuthorization =
	| { session: AdminSession; status: "authorized" }
	| { session: AdminSession; status: "forbidden" }
	/** Signed in, but OpenScholar gives this person no role in the library. */
	| { organisationName: string | null; status: "no_access" }
	| { status: "unauthenticated" }
	| { status: "unavailable" };

type RoleAnswer = { role: AdminRole } | { organisationName: string | null };

/** OpenScholar decides roles; the answer is reused for about a minute. */
const ADMIN_ROLE_CACHE_MS = 60_000;
const roleAnswers = new Map<string, { answer: RoleAnswer; expiresAt: number }>();

const roleResponseSchema = z.object({ role: adminRoleSchema });
const noAccessResponseSchema = z.object({ organisationName: z.string().optional() });

async function readAdminRole(config: LibraryServerConfig, clerkUserId: string): Promise<RoleAnswer | null> {
	const { convexSiteUrl, libraryId, machineCredential } = config.authentication.openScholar;
	const cacheKey = `${libraryId}:${clerkUserId}`;
	const cached = roleAnswers.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.answer;

	let response: Response;
	try {
		response = await fetch(new URL("/api/v1/evidence-libraries/admin-session/check", convexSiteUrl), {
			method: "POST",
			cache: "no-store",
			signal: AbortSignal.timeout(5_000),
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${machineCredential}` },
			body: JSON.stringify({ libraryId, clerkUserId }),
		});
	} catch (error) {
		console.error("Admin access check unavailable", { libraryId, error });
		return null;
	}
	const body = await response.json().catch(() => null);
	let answer: RoleAnswer;
	if (response.ok) {
		const result = roleResponseSchema.safeParse(body);
		if (!result.success) {
			console.error("Invalid admin access response", { libraryId });
			return null;
		}
		answer = { role: result.data.role };
	} else if (response.status === 403) {
		answer = { organisationName: noAccessResponseSchema.safeParse(body).data?.organisationName ?? null };
	} else {
		console.error("Admin access check rejected", { libraryId, status: response.status });
		return null;
	}
	roleAnswers.set(cacheKey, { answer, expiresAt: Date.now() + ADMIN_ROLE_CACHE_MS });
	return answer;
}

/**
 * Whether the person signed in on this request may do something in /admin.
 * They sign in with OpenScholar like any reader; OpenScholar decides their
 * role by their Clerk user ID.
 */
export async function authorizeAdminRequest(
	headers: Headers,
	permission: AdminPermission,
	config?: LibraryServerConfig,
): Promise<AdminSessionAuthorization> {
	config ??= await getLibraryConfig();
	// Mock only, never merged: a local copy against a live library acts as the owner OpenScholar names.
	const mockOwner = process.env.MOCK_ADMIN_CLERK_USER_ID;
	const reader = mockOwner
		? { clerkUserId: mockOwner, name: "Mock owner", image: null }
		: await getSignedInOpenScholarUser(headers, config);
	if (!reader) return { status: "unauthenticated" };
	const answer = await readAdminRole(config, reader.clerkUserId);
	if (!answer) return { status: "unavailable" };
	if (!("role" in answer)) return { organisationName: answer.organisationName, status: "no_access" };
	const session = { clerkUserId: reader.clerkUserId, role: answer.role, name: reader.name, image: reader.image };
	return { session, status: adminRoleHasPermission(session.role, permission) ? "authorized" : "forbidden" };
}
