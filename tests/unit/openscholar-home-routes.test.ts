import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(),
}));

const machineCredential = `els_${"a".repeat(43)}`;
const { listReviewedPublications, loadQuestionFacts } = vi.hoisted(() => ({
	listReviewedPublications: vi.fn(),
	loadQuestionFacts: vi.fn(),
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: async () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
				loginPageUrl: "https://openscholar.example.org/evidence-libraries/amber",
				machineCredential,
			},
			secret: "12345678901234567890123456789012",
		},
	}),
}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(async () => ({})) }));
vi.mock("@/lib/admin/reviewed-publication-catalog", () => ({ listReviewedPublications }));
vi.mock("@/components/pages/home-data", () => ({ loadQuestionFacts }));

import { GET as getReviewed } from "@/app/api/openscholar/reviewed-publications/route";
import { GET as getQuestions } from "@/app/api/openscholar/home-questions/route";

function request(path: string, authorization = `Bearer ${machineCredential}`) {
	return new NextRequest(`https://library.example.org${path}`, { headers: { authorization } });
}

beforeEach(() => {
	listReviewedPublications.mockReset();
	listReviewedPublications.mockResolvedValue({ items: [{ key: "ABCD1234", title: "Teacher coaching", publishedAt: "2026-09-01T00:00:00.000Z", reviewer: "user_amina" }], nextCursor: null });
	loadQuestionFacts.mockResolvedValue({ topics: [{ name: "Teacher training", count: 4 }], collections: [], countries: { KE: 3 }, countryPaths: { KE: "Africa > KE" } });
});

describe("OpenScholar home page reads", () => {
	it("refuse a caller without the library's machine credential", async () => {
		expect((await getReviewed(request("/api/openscholar/reviewed-publications", "Bearer wrong"))).status).toBe(401);
		expect((await getQuestions(request("/api/openscholar/home-questions", ""))).status).toBe(401);
		expect(listReviewedPublications).not.toHaveBeenCalled();
	});

	it("pass the search, cursor, page size and keys to the reviewed publications list", async () => {
		const response = await getReviewed(request("/api/openscholar/reviewed-publications?query=coach&cursor=abc&pageSize=10"));
		expect(response.status).toBe(200);
		expect(listReviewedPublications).toHaveBeenCalledWith({}, { cursor: "abc", ids: null, pageSize: "10", query: "coach" });
		expect((await response.json()).items[0].reviewer).toBe("user_amina");
	});

	it("return the page's own example questions, with an empty slot as null", async () => {
		const response = await getQuestions(request("/api/openscholar/home-questions"));
		expect(await response.json()).toEqual({
			questions: ["What does the evidence say about teacher training?", "What has been studied in Kenya?", null],
		});
	});
});
