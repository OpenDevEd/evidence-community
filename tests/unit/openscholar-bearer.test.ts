import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const machineCredential = `els_${"a".repeat(43)}`;

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: async () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
				loginPageUrl:
					"https://openscholar.example.org/evidence-libraries/amber",
				machineCredential,
			},
			secret: "12345678901234567890123456789012",
		},
	}),
}));

import { adminSessionCookieName } from "@/lib/admin/access";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";

function request(headers: Record<string, string> = {}) {
	return new NextRequest(
		"https://library.example.org/api/openscholar/institutions",
		{ headers },
	);
}

describe("OpenScholar bearer guard", () => {
	it("accepts the library's machine credential", async () => {
		await expect(
			requireOpenScholarBearer(
				request({ authorization: `Bearer ${machineCredential}` }),
			),
		).resolves.toBeNull();
	});

	it.each([
		["a missing header", {}],
		["a wrong credential", { authorization: `Bearer els_${"b".repeat(43)}` }],
		["a credential with the wrong length", { authorization: "Bearer els_short" }],
		[
			"an admin session cookie without a bearer",
			{ cookie: `${adminSessionCookieName()}=signed-session-token` },
		],
	])("rejects %s with 401", async (_label, headers) => {
		const response = await requireOpenScholarBearer(request(headers));

		expect(response?.status).toBe(401);
		expect(response?.headers.get("cache-control")).toBe("no-store");
		expect(await response?.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "Use the library's machine credential as a bearer token.",
			},
		});
	});
});
