import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(),
}));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));

const signedIn = { clerkUserId: undefined as string | undefined };
const signInHandler = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
				libraryUrl: "https://openscholar.example.org/evidence-libraries/amber",
				machineCredential: `els_${"a".repeat(43)}`,
			},
		},
		identity: { baseUrl: "https://library.example.org" },
		localization: { defaultLocale: "en-GB" },
		services: { publication: { crossref: { enabled: false }, zenodo: { enabled: false } } },
	}),
}));
vi.mock("@/lib/readers/instance", () => ({
	getReaderAuthForConfig: async () => ({ auth: { handler: signInHandler } }),
}));
vi.mock("next/headers", async () => {
	const { signedInHeaders } = await import("../helpers/reader-session");
	return { headers: async () => signedInHeaders(signedIn.clerkUserId) };
});
vi.mock("@opendeved/evidence-library-core/zotero-schema", () => ({
	getZoteroSchema: () => ({ itemTypes: [] }),
}));
vi.mock("@/components/admin/AdminWorkbench", () => ({ default: () => null }));
// The page reads the library's sources for the workbench; these tests are about who gets in.
vi.mock("@/db", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/lib/admin/library-query-service", () => ({ getAdminLibrarySnapshot: async () => ({ sources: [] }) }));

import AdminPage from "@/app/[locale]/admin/page";
import { GET as startSignIn } from "@/app/api/admin/sign-in/route";
import { AdminNoAccess } from "@/components/admin/AdminNoAccess";

async function captureRedirect(render: Promise<unknown>) {
	try {
		await render;
	} catch (error) {
		const digest = (error as { digest?: string }).digest ?? "";
		const parsed = digest.match(/^NEXT_REDIRECT;(?:replace|push);(.*);(\d+);$/u);
		if (parsed) return { status: Number(parsed[2]), url: parsed[1] };
		throw error;
	}
	return null;
}

afterEach(() => vi.unstubAllGlobals());

async function signInBody(call = 0) {
	return JSON.parse(await signInHandler.mock.calls[call]![0].text()) as Record<string, unknown>;
}

describe("admin sign-in route", () => {
	beforeEach(() => {
		signInHandler.mockReset().mockImplementation(async () =>
			Response.json(
				{ url: "https://clerk.openscholar.example.org/oauth/authorize?state=signed-state", redirect: false },
				{ headers: [["set-cookie", "evidence-library.state=signed-state; Path=/; HttpOnly"]] },
			),
		);
	});

	it("sends the visitor to OpenScholar and keeps the sign-in state cookie", async () => {
		const response = await startSignIn(new NextRequest("http://localhost/api/admin/sign-in?return=%2Fen-GB%2Fadmin%2Fitems%3Fscope%3Ddrafts"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://clerk.openscholar.example.org/oauth/authorize?state=signed-state");
		expect(response.headers.get("set-cookie")).toContain("evidence-library.state=signed-state");
		expect(await signInBody()).toEqual({
			provider: "openscholar",
			callbackURL: "/en-GB/admin/items?scope=drafts",
			disableRedirect: true,
		});
	});

	it.each(["https://evil.example.org/admin", "//evil.example.org", "/lib"])(
		"comes back to /admin instead of %s",
		async (unsafeReturn) => {
			await startSignIn(new NextRequest(`http://localhost/api/admin/sign-in?${new URLSearchParams({ return: unsafeReturn })}`));
			expect((await signInBody()).callbackURL).toBe("/admin");
		},
	);

	it("asks which account is signing in once this browser signed out here, instead of taking the one Clerk holds", async () => {
		const afterSignOut = new NextRequest("http://localhost/api/admin/sign-in?return=%2Fadmin", { headers: { cookie: "openscholar-sign-in-asks=1" } });
		expect(new URL((await startSignIn(afterSignOut)).headers.get("location")!).searchParams.get("prompt")).toBe("login");
		const fresh = new NextRequest("http://localhost/api/admin/sign-in?return=%2Fadmin");
		expect(new URL((await startSignIn(fresh)).headers.get("location")!).searchParams.has("prompt")).toBe(false);
	});

	it("passes on Better Auth's refusal, such as its rate limit, instead of redirecting", async () => {
		signInHandler.mockImplementation(async () => new Response(null, { status: 429 }));
		const response = await startSignIn(new NextRequest("http://localhost/api/admin/sign-in?return=%2Fadmin"));
		expect(response.status).toBe(429);
		expect(response.headers.get("location")).toBeNull();
	});
});

describe("admin page", () => {
	beforeEach(() => {
		signedIn.clerkUserId = undefined;
	});

	it("sends a signed-out visitor to sign in with the page to come back to", async () => {
		const redirect = await captureRedirect(
			AdminPage({ params: Promise.resolve({ locale: "en-GB" as const }), searchParams: Promise.resolve({ scope: "drafts" }) }),
		);
		expect(redirect).toEqual({ status: 307, url: "/api/admin/sign-in?return=%2Fadmin%3Fscope%3Ddrafts" });
	});

	it("keeps the locale of the admin page it came from", async () => {
		const redirect = await captureRedirect(
			AdminPage({ params: Promise.resolve({ locale: "fr" as const }), searchParams: Promise.resolve({}) }),
		);
		expect(redirect?.url).toBe("/api/admin/sign-in?return=%2Ffr%2Fadmin");
	});

	it("keeps someone OpenScholar gives a role on the admin page", async () => {
		signedIn.clerkUserId = "user_admin_page_editor";
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "editor" })));
		const redirect = await captureRedirect(
			AdminPage({ params: Promise.resolve({ locale: "en-GB" as const }), searchParams: Promise.resolve({}) }),
		);
		expect(redirect).toBeNull();
	});

	it("shows someone without a role which organisation to ask", async () => {
		signedIn.clerkUserId = "user_admin_page_outsider";
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "access_revoked", organisationName: "OpenDevEd" }, { status: 403 })));
		const page = await AdminPage({ params: Promise.resolve({ locale: "en-GB" as const }), searchParams: Promise.resolve({}) });
		expect(page).toMatchObject({ type: AdminNoAccess, props: { organisationName: "OpenDevEd" } });
	});
});
