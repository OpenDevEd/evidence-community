import "server-only";

import {
	adminSessionIdentitySchema,
	type AdminAccessConfig,
	type AdminSessionIdentity,
} from "@/lib/admin/access";

const ADMIN_LOGIN_CODE_PATTERN = /^elc_[A-Za-z0-9_-]{43}$/u;
const ADMIN_LOGIN_REDEMPTION_PATH =
	"/api/evidence-libraries/admin-login/redeem";

const redemptionResponseSchema = adminSessionIdentitySchema;

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
