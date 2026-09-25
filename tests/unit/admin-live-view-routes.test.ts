import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestCookie: undefined as string | undefined, revalidateTag: vi.fn() }));
const signingConfig = { libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5", secret: "12345678901234567890123456789012" };
const otherLibrarySecret = "abcdefghijklmnopqrstuvwxyz123456";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mocks.requestCookie ? { value: mocks.requestCookie } : undefined) }) }));
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

import {
	ADMIN_SESSION_TTL_MS,
	adminSessionCookieName,
	createAdminSessionToken,
	createLiveViewToken,
	hasLiveView,
	liveViewCookieName,
	verifyLiveViewToken,
} from "@/lib/admin/access";
import { POST as enableLiveView } from "@/app/api/admin/live-view/route";
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

describe("live view and public cache routes", () => {
	beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		mocks.requestCookie = undefined;
	});

	it("gives only Editors and Owners a live view cookie for this library", async () => {
		for (const [role, status] of [[undefined, 401], ["creator", 403], ["editor", 204], ["owner", 204]] as const) {
			const response = await enableLiveView(request("/api/admin/live-view", "POST", role));
			expect(response.status, String(role)).toBe(status);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
			const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${liveViewCookieName()}=`))?.split(";")[0].split("=")[1];
			expect(verifyLiveViewToken(cookie, signingConfig.secret), String(role)).toBe(status === 204 ? "user_2abc" : null);
			expect(verifyLiveViewToken(cookie, otherLibrarySecret), String(role)).toBeNull();
		}
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

describe("live view cookie", () => {
	const now = Date.UTC(2026, 8, 25, 12);
	const token = createLiveViewToken("user_2abc", signingConfig.secret, now);

	it("accepts only an unexpired value signed with this library's secret", () => {
		expect(verifyLiveViewToken(token, signingConfig.secret, now + 1_000)).toBe("user_2abc");
		expect(verifyLiveViewToken(token, signingConfig.secret, now + ADMIN_SESSION_TTL_MS)).toBeNull();
		expect(verifyLiveViewToken(`${token}x`, signingConfig.secret, now)).toBeNull();
		expect(verifyLiveViewToken(createLiveViewToken("user_2abc", otherLibrarySecret, now), signingConfig.secret, now)).toBeNull();
		const signature = token.split(".")[1];
		const forged = Buffer.from(JSON.stringify({ adminId: "user_2abc", expiresAt: now + 10 * ADMIN_SESSION_TTL_MS, purpose: "live-view" })).toString("base64url");
		expect(verifyLiveViewToken(`${forged}.${signature}`, signingConfig.secret, now)).toBeNull();
	});

	it("does not treat an admin session as live view", () => {
		const session = createAdminSessionToken(
			{ clerkOrganizationId: "org_2abc", clerkUserId: "user_2abc", consumedAt: now, libraryId: signingConfig.libraryId, role: "owner" },
			signingConfig,
			now,
		);
		expect(verifyLiveViewToken(session, signingConfig.secret, now)).toBeNull();
	});

	it("turns on live reads for the request only with a valid cookie", async () => {
		expect(await hasLiveView()).toBe(false);
		mocks.requestCookie = createLiveViewToken("user_2abc", signingConfig.secret);
		expect(await hasLiveView()).toBe(true);
		mocks.requestCookie = createLiveViewToken("user_2abc", otherLibrarySecret);
		expect(await hasLiveView()).toBe(false);
	});
});
