import "server-only";

import { z } from "zod";

import type {
	AdminAccessConfig,
	AdminSessionIdentity,
} from "@/lib/admin/access";

export const ADMIN_LOGIN_CODE_PATTERN = /^elc_[A-Za-z0-9_-]{43}$/u;
const ADMIN_LOGIN_REDEMPTION_PATH =
	"/api/evidence-libraries/admin-login/redeem";

const redemptionResponseSchema = z
	.object({
		clerkOrganizationId: z.string().trim().min(1).max(512),
		clerkUserId: z.string().trim().min(1).max(512),
		consumedAt: z.number().int().nonnegative(),
		libraryId: z.string().trim().min(1).max(128),
		role: z.enum(["owner", "editor"]),
	})
	.strict();

export async function redeemAdminLoginCode(
	code: string,
	config: AdminAccessConfig,
): Promise<AdminSessionIdentity | null> {
	if (!ADMIN_LOGIN_CODE_PATTERN.test(code)) return null;

	let response: Response;
	try {
		response = await fetch(
			new URL(ADMIN_LOGIN_REDEMPTION_PATH, config.convexSiteUrl).toString(),
			{
				body: JSON.stringify({ libraryId: config.libraryId, code }),
				cache: "no-store",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${config.machineCredential}`,
					"Content-Type": "application/json",
				},
				method: "POST",
			},
		);
	} catch {
		return null;
	}
	if (!response.ok) return null;

	const body = await response.json().catch(() => null);
	const result = redemptionResponseSchema.safeParse(body);
	if (!result.success || result.data.libraryId !== config.libraryId) {
		return null;
	}
	return result.data;
}
