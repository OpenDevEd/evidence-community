import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
	config: vi.fn(),
	database: vi.fn(),
	links: vi.fn(),
	metrics: vi.fn(),
	readSearchDocument: vi.fn(),
	searchKeys: vi.fn(),
}));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: mocks.config }));
vi.mock("@/db", () => ({ getDatabaseForConfig: mocks.database }));
vi.mock("@/lib/links/item-links", () => ({ getPublicItemLinks: mocks.links }));
vi.mock("@/lib/links/citation-metrics", () => ({ getSourceCitationMetrics: mocks.metrics }));
vi.mock("@/lib/attachment-visibility", () => ({ filterPublicAttachments: () => [] }));
vi.mock("@/lib/tags", () => ({ hasAnyTag: () => false, publicTagRules: () => ({}) }));
vi.mock("@/lib/search", () => ({
	publicFields: () => ({}),
	readSearchDocument: mocks.readSearchDocument,
	searchKeys: mocks.searchKeys,
}));

import { GET } from "@/app/api/citations/[key]/route";

const metric = { provider: "openalex", workId: "W1", citedByCount: 7, referencedWorksCount: 30 };
const record = { key: "ABCD2345", deleted: 0, tags: [], links: { cites: [], citedBy: ["EFGH6789"], related: [] }, citationMetrics: [metric] };
const configFor = (search: object) => ({ services: { search }, content: { tags: { hidden: [] } } });
const read = async () => {
	const response = await GET(new NextRequest("http://library.test/api/citations/ABCD2345"), { params: Promise.resolve({ key: "ABCD2345" }) });
	return response.json();
};

describe("a record's citing records", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readSearchDocument.mockResolvedValue(record);
		mocks.searchKeys.mockResolvedValue({ hits: [{ key: "EFGH6789" }], total: 1, facets: {} });
	});

	it("come from the record itself in an index-only library, whose database is empty", async () => {
		mocks.config.mockResolvedValue(configFor({ engine: "elasticsearch", indexOnly: true }));

		const body = await read();

		expect(body).toMatchObject({ libraryCitationCount: 1, sourceCitationMetrics: [metric], citingItems: [{ key: "EFGH6789" }] });
		expect(mocks.database).not.toHaveBeenCalled();
	});

	it("come from the database in any other library", async () => {
		mocks.config.mockResolvedValue(configFor({ engine: "elasticsearch" }));
		mocks.links.mockResolvedValue({ cites: [], citedBy: ["EFGH6789", "JKLM2345"], related: [] });
		mocks.metrics.mockResolvedValue([]);

		await expect(read()).resolves.toMatchObject({ libraryCitationCount: 2, sourceCitationMetrics: [] });
	});
});
