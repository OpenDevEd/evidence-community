import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
				machineCredential: `els_${"a".repeat(43)}`,
			},
		},
	}),
}));

import { signedInHeaders } from "../helpers/reader-session";
import { DELETE as clearPublicCache } from "@/app/api/admin/public-cache/route";

type Role = "owner" | "editor" | "creator";

// OpenScholar answers the current role for the signed-in person.
function request(path: string, method: string, role?: Role) {
	vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role })));
	return new NextRequest(`https://library.example.org${path}`, {
		method,
		headers: signedInHeaders(role ? `user_cache_${role}` : undefined),
	});
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
