import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(),
}));

const libraryId = "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5";
const machineCredential = `els_${"a".repeat(43)}`;
const code = `elc_${"b".repeat(43)}`;
const secret = "12345678901234567890123456789012";
const openScholar = {
	convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
	libraryId,
	loginPageUrl: "https://openscholar.example.org/evidence-libraries/amber",
	machineCredential,
};

const adminCookie = { value: undefined as string | undefined };

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: { openScholar, secret },
		localization: { defaultLocale: "en-GB" },
	}),
}));
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) =>
			name === "evidence_library_admin" && adminCookie.value
				? { name, value: adminCookie.value }
				: undefined,
	}),
}));
vi.mock("@opendeved/evidence-library-core/zotero-schema", () => ({
	getZoteroSchema: () => ({ itemTypes: [] }),
}));
vi.mock("@/components/admin/AdminWorkbench", () => ({
	default: () => null,
}));

import AdminPage from "@/app/[locale]/admin/page";
import { GET as redeem } from "@/app/api/admin/session/route";
import { POST as logout } from "@/app/api/admin/session/logout/route";
import {
	adminSessionCookieName,
	createAdminSessionToken,
	verifyAdminSessionToken,
} from "@/lib/admin/access";

const redeemedIdentity = {
	clerkOrganizationId: "org_real",
	clerkUserId: "user_real",
	consumedAt: Date.UTC(2026, 7, 24, 12),
	libraryId,
	role: "editor" as const,
};

function redeemRequest(
	query = `code=${encodeURIComponent(code)}`,
	proxied = false,
) {
	return new NextRequest(
		proxied
			? `http://web:3000/api/admin/session?${query}`
			: `http://localhost/api/admin/session?${query}`,
		proxied
			? {
					headers: {
						host: "web:3000",
						"x-forwarded-host": "library.example.org",
						"x-forwarded-proto": "https",
					},
				}
			: undefined,
	);
}

async function captureRedirect(render: Promise<unknown>) {
	try {
		await render;
	} catch (error) {
		const digest = (error as { digest?: string }).digest ?? "";
		const parsed = digest.match(
			/^NEXT_REDIRECT;(?:replace|push);(.*);(\d+);$/u,
		);
		if (parsed) return { status: Number(parsed[2]), url: parsed[1] };
		throw error;
	}
	return null;
}

function sessionCookieValue(response: Response) {
	const setCookie = response.headers.get("set-cookie") ?? "";
	const match = setCookie.match(/evidence_library_admin=([^;]+)/u);
	return match?.[1];
}

describe("admin session routes", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("redeems the opaque code and signs only the returned identity", async () => {
		fetchMock.mockResolvedValue(Response.json(redeemedIdentity));
		const query = new URLSearchParams({
			clerkOrganizationId: "org_attacker",
			clerkUserId: "user_attacker",
			code,
			libraryId: "attacker-library",
			role: "owner",
		});

		const response = await redeem(redeemRequest(query.toString()));
		const token = sessionCookieValue(response);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("http://localhost/admin");
		expect(response.headers.get("set-cookie")).toContain("HttpOnly");
		expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
		expect(response.headers.get("set-cookie")).toContain("Path=/");
		expect(response.headers.get("set-cookie")).not.toContain("Domain=");
		expect(
			verifyAdminSessionToken(token, { libraryId, secret }),
		).toMatchObject(redeemedIdentity);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://spotted-woodpecker-546.convex.site/api/v1/evidence-libraries/admin-login/redeem",
			{
				body: JSON.stringify({ libraryId, code }),
				cache: "no-store",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${machineCredential}`,
					"Content-Type": "application/json",
				},
				method: "POST",
			},
		);
	});

	it.each([400, 401])(
		"does not create a session when OpenScholar returns HTTP %i",
		async (status) => {
			fetchMock.mockResolvedValue(
				Response.json({ error: "rejected" }, { status }),
			);

			const response = await redeem(redeemRequest());

			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe(
				`${openScholar.loginPageUrl}?error=invalid_code&return=%2Fadmin`,
			);
			expect(response.headers.get("set-cookie")).toBeNull();
		},
	);

	it("rejects a successful response for another library", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				...redeemedIdentity,
				libraryId: "kg2k5yaf2g58kz9kw7h3k2j3v6zq5h4p",
			}),
		);

		const response = await redeem(redeemRequest());

		expect(response.headers.get("location")).toBe(
			`${openScholar.loginPageUrl}?error=invalid_code&return=%2Fadmin`,
		);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("rejects a malformed code without contacting OpenScholar", async () => {
		const response = await redeem(
			redeemRequest("code=user_123&role=owner"),
		);

		expect(response.headers.get("location")).toBe(
			`${openScholar.loginPageUrl}?error=invalid_code&return=%2Fadmin`,
		);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("uses the public HTTPS origin behind the deployment proxy", async () => {
		fetchMock.mockResolvedValue(Response.json(redeemedIdentity));

		const response = await redeem(redeemRequest(undefined, true));

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://library.example.org/admin",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"evidence_library_admin=",
		);
	});

	it("returns to the admin page the visitor asked for", async () => {
		fetchMock.mockResolvedValue(Response.json(redeemedIdentity));
		const query = new URLSearchParams({
			code,
			return: "/en-GB/admin/items?scope=drafts",
		});

		const response = await redeem(redeemRequest(query.toString()));

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"http://localhost/en-GB/admin/items?scope=drafts",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"evidence_library_admin=",
		);
	});

	it.each(["https://evil.example.org/admin", "//evil.example.org", "/lib"])(
		"ignores %s as a return target",
		async (unsafeReturn) => {
			fetchMock.mockResolvedValue(Response.json(redeemedIdentity));
			const query = new URLSearchParams({ code, return: unsafeReturn });

			const response = await redeem(redeemRequest(query.toString()));

			expect(response.headers.get("location")).toBe(
				"http://localhost/admin",
			);
		},
	);

	it("keeps the return path when the code is refused", async () => {
		fetchMock.mockResolvedValue(
			Response.json({ error: "rejected" }, { status: 400 }),
		);
		const query = new URLSearchParams({
			code,
			return: "/admin/items?scope=drafts",
		});

		const response = await redeem(redeemRequest(query.toString()));

		expect(response.headers.get("location")).toBe(
			`${openScholar.loginPageUrl}?error=invalid_code&return=%2Fadmin%2Fitems%3Fscope%3Ddrafts`,
		);
	});

	it("clears the cookie on logout", async () => {
		const response = await logout(
			new NextRequest("http://localhost/api/admin/session/logout", {
				headers: { origin: "http://localhost" },
				method: "POST",
			}),
		);
		const cookie = response.headers.get("set-cookie") ?? "";

		expect(response.status).toBe(303);
		expect(cookie).toContain(`${adminSessionCookieName()}=`);
		expect(cookie).toContain("Max-Age=0");
	});

	it("accepts logout through the public HTTPS proxy origin", async () => {
		const response = await logout(
			new NextRequest("http://web:3000/api/admin/session/logout", {
				headers: {
					host: "web:3000",
					origin: "https://library.example.org",
					"x-forwarded-host": "library.example.org",
					"x-forwarded-proto": "https",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://library.example.org/admin",
		);
	});
});

describe("signed-out admin page", () => {
  afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		adminCookie.value = undefined;
	});

	it("sends the visitor to OpenScholar with the page to come back to", async () => {
		const redirect = await captureRedirect(
			AdminPage({
				params: Promise.resolve({ locale: "en-GB" as const }),
				searchParams: Promise.resolve({ scope: "drafts" }),
			}),
		);

		expect(redirect).toEqual({
			status: 307,
			url: `${openScholar.loginPageUrl}?return=%2Fadmin%3Fscope%3Ddrafts`,
		});
	});

	it("keeps the locale of the admin page it came from", async () => {
		const redirect = await captureRedirect(
			AdminPage({
				params: Promise.resolve({ locale: "fr" as const }),
				searchParams: Promise.resolve({}),
			}),
		);

		expect(redirect?.url).toBe(
			`${openScholar.loginPageUrl}?return=%2Ffr%2Fadmin`,
		);
	});

	it("keeps a signed-in visitor on the admin page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "editor" })));
		adminCookie.value = createAdminSessionToken(redeemedIdentity, {
			libraryId,
			secret,
		});

		const redirect = await captureRedirect(
			AdminPage({
				params: Promise.resolve({ locale: "en-GB" as const }),
				searchParams: Promise.resolve({}),
			}),
		);

		expect(redirect).toBeNull();
	});
});
