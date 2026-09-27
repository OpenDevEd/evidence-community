import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
const signingConfig = { libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5", secret: "12345678901234567890123456789012" };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: signingConfig.libraryId,
				loginPageUrl: "https://openscholar.example.org/evidence-libraries/amber",
				machineCredential: `els_${"a".repeat(43)}`,
			},
			secret: signingConfig.secret,
		},
	}),
}));

import { adminSessionCookieName, createAdminSessionToken } from "@/lib/admin/access";
import { DELETE as clearPublicCache } from "@/app/api/admin/public-cache/route";

type Role = "owner" | "editor" | "creator";

// OpenScholar answers the current role; the signed cookie only names the user.
function request(path: string, method: string, role?: Role) {
	vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role })));
	const headers = new Headers();
	if (role) {
		const token = createAdminSessionToken(
			{ clerkOrganizationId: "org_2abc", clerkUserId: "user_2abc", consumedAt: Date.now(), libraryId: signingConfig.libraryId, role },
			signingConfig,
		);
		headers.set("cookie", `${adminSessionCookieName()}=${token}`);
	}
	return new NextRequest(`https://library.example.org${path}`, { method, headers });
}

describe("public cache route", () => {
	beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("clears the public cache only for Owners", async () => {
		for (const [role, status] of [[undefined, 401], ["creator", 403], ["editor", 403], ["owner", 204]] as const) {
			mocks.revalidateTag.mockClear();
			const response = await clearPublicCache(request("/api/admin/public-cache", "DELETE", role));
			expect(response.status, String(role)).toBe(status);
			expect(mocks.revalidateTag.mock.calls, String(role)).toEqual(status === 204 ? [["library", { expire: 0 }]] : []);
		}
	});
});
