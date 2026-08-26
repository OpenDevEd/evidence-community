import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(),
}));

const machineCredential = `els_${"a".repeat(43)}`;
const { execute, listOpenScholarCollections } = vi.hoisted(() => ({
	execute: vi.fn(),
	listOpenScholarCollections: vi.fn(),
}));

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
vi.mock("@/db", () => ({ getDatabase: vi.fn(async () => ({ execute })) }));
vi.mock("@/lib/admin/collection-catalog-service", () => ({
	listOpenScholarCollections,
}));

import { GET as getCollections } from "@/app/api/openscholar/collections/route";
import { GET as getInstitutions } from "@/app/api/openscholar/institutions/route";

function request(path: string, authorization = `Bearer ${machineCredential}`) {
	return new NextRequest(`https://library.example.org${path}`, {
		headers: { authorization },
	});
}

beforeEach(() => {
	listOpenScholarCollections.mockResolvedValue({
		items: [
			{
				count: 3,
				id: "ABCD1234",
				parentId: null,
				source: "native",
				title: "Teacher training",
			},
		],
		nextCursor: "next",
	});
	execute.mockResolvedValue({
		rows: [
			{ count: "4", name: "Amber Institute" },
			{ count: "1", name: "Indigo College" },
		],
	});
});

describe("OpenScholar collections route", () => {
	it("passes search text, cursor, and page size to the catalogue and returns the page", async () => {
		const response = await getCollections(
			request(
				"/api/openscholar/collections?query=teacher&cursor=abc&pageSize=10",
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			items: [
				{
					count: 3,
					id: "ABCD1234",
					parentId: null,
					source: "native",
					title: "Teacher training",
				},
			],
			nextCursor: "next",
		});
		expect(listOpenScholarCollections).toHaveBeenCalledWith(
			expect.objectContaining({ execute }),
			{ cursor: "abc", pageSize: "10", query: "teacher" },
		);
	});

	it("rejects a wrong bearer before touching the database", async () => {
		const response = await getCollections(
			request("/api/openscholar/collections", "Bearer els_wrong"),
		);

		expect(response.status).toBe(401);
		expect(listOpenScholarCollections).not.toHaveBeenCalled();
	});
});

describe("OpenScholar institutions route", () => {
	it("returns every institution name with a numeric record count", async () => {
		const response = await getInstitutions(
			request("/api/openscholar/institutions"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			items: [
				{ count: 4, name: "Amber Institute" },
				{ count: 1, name: "Indigo College" },
			],
		});
	});

	it("rejects a missing bearer", async () => {
		const response = await getInstitutions(
			new NextRequest("https://library.example.org/api/openscholar/institutions"),
		);

		expect(response.status).toBe(401);
		expect(execute).not.toHaveBeenCalled();
	});
});
