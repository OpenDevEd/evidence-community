import { expect, it, vi } from "vitest";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/app/api/cache", () => ({ getCachedCollections: async () => [] }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
const service = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/elasticsearch", () => ({ getSearchForConfig: async () => ({ alias: "library", client: service }) }));

/** An Elasticsearch answer holding these records. */
function found(records: Array<Record<string, unknown>>) {
	return { hits: { total: { value: records.length, relation: "eq" }, hits: records.map((record) => ({ _source: record, sort: [record.key] })) } };
}

/** What the last search asked Elasticsearch to send back. */
function sentFields() {
	return service.search.mock.lastCall?.[0]._source;
}
import { getLibraryConfig } from "@/config/library-config/server";
import { getPublicItems } from "@/lib/search";
import { POST as readBatch } from "@/app/api/items/batch/route";

it("removes hidden and deleted attachments, file note text and PDF full text from full search results", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	service.search.mockResolvedValue(found([{
		key: "PUBAAAAA", title: "Published record", attachmentsData: [
			{ key: "VISIBLEA", deleted: 0, tags: [], url: "https://example.org/public.pdf", itemType: "Attachment", note: "<p>Kept on the file</p>" },
			{ key: "HIDDENAA", deleted: 0, tags: ["Hidden", "_r:doi"], url: "https://doi.org/10.5555/hidden" },
			{ key: "DELETEDD", deleted: 1, tags: [], url: "https://example.org/deleted.pdf" },
		],
	}]));
	const result = await getPublicItems({}, { includeHeavyFields: true });
	expect(result.items[0].attachmentsData).toEqual([
		{ key: "VISIBLEA", deleted: 0, tags: [], url: "https://example.org/public.pdf", itemType: "Attachment", note: null },
	]);
	expect(sentFields()).toEqual({ excludes: ["fullTextPDFs", "topics", "topicAncestors"] });
});

it("gives list results only the attachments the item page shows, without unpublished note text", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	// The record's publish tags are its Zotero source's.
	const zotero = config.sources.find((source) => source.provider === "zotero")!;
	if (zotero.provider === "zotero") zotero.settings.pdfPublishing = { mode: "tagged", tags: ["_publish"] };
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	const attachment = { deleted: 0, parentItem: "PUBAAAAA", filename: null, title: null, url: null, PDFCoverPageImage: null, linkMode: null, itemType: "Attachment", note: null, fullTextPDF: [{ text: "body", page: 1 }] };
	service.search.mockResolvedValue(found([{
		key: "PUBAAAAA", title: "Published record", sourceConnectionKey: zotero.key, attachmentsData: [
			{ ...attachment, key: "COVERPDF", tags: [], filename: "report.pdf", PDFCoverPageImage: "cover.png" },
			{ ...attachment, key: "PLAINPDF", tags: [], filename: "draft.pdf" },
			{ ...attachment, key: "DOILINKA", tags: ["_r:doi"], linkMode: "linked_url", url: "https://doi.org/10.5281/zenodo.123" },
			{ ...attachment, key: "PUBNOTEA", itemType: "Note", tags: ["_publish"], note: "<p>Shown</p>" },
			{ ...attachment, key: "PRIVNOTE", itemType: "Note", tags: [], note: "<p>Private</p>" },
			{ ...attachment, key: "HIDNOTEA", itemType: "Note", tags: ["_publish", "hidden"], note: "<p>Hidden</p>" },
		],
	}]));
	const result = await getPublicItems({});
	const common = { parentItem: "PUBAAAAA", itemType: "Attachment", linkMode: null, title: null, filename: null, url: null, PDFCoverPageImage: null, note: null };
	expect(result.items[0].attachmentsData).toEqual([
		{ ...common, key: "COVERPDF", tags: [], filename: "report.pdf", PDFCoverPageImage: "cover.png" },
		{ ...common, key: "DOILINKA", tags: ["_r:doi"], linkMode: "linked_url", url: "https://doi.org/10.5281/zenodo.123" },
		{ ...common, key: "PUBNOTEA", itemType: "Note", tags: ["_publish"], note: "<p>Shown</p>" },
	]);
	expect(sentFields()).toContain("attachmentsData");
});

it("removes hidden and deleted attachments from full batch results used by the assistant", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	service.search.mockResolvedValue(found([{
		key: "PUBAAAAA", title: "Published record", attachmentsData: [
			{ key: "VISIBLEA", deleted: 0, tags: [], PDFCoverPageImage: "public.png" },
			{ key: "HIDDENAA", deleted: 0, tags: ["hidden"], PDFCoverPageImage: "hidden.png" },
			{ key: "DELETEDD", deleted: 1, tags: [], PDFCoverPageImage: "deleted.png" },
		],
	}]));
	const response = await readBatch(new Request("http://localhost/api/items/batch", {
		method: "POST",
		body: JSON.stringify({ keys: ["PUBAAAAA"], includeHeavyFields: true }),
	}) as never);
	const { items } = await response.json();
	expect(items[0].attachmentsData.map((attachment: { key: string }) => attachment.key)).toEqual(["VISIBLEA"]);
	expect(sentFields()).toEqual({ excludes: ["fullTextPDFs", "topics", "topicAncestors"] });
});

it("never retrieves PDF full text, nor topics when the library has them off", async () => {
	vi.mocked(getLibraryConfig).mockResolvedValue(libraryConfigSchema.parse(maximalLibraryConfig));
	service.search.mockResolvedValue(found([]));
	await getPublicItems({}, { includeHeavyFields: true });
	expect(sentFields()).toEqual({ excludes: ["fullTextPDFs", "topics", "topicAncestors"] });
});
