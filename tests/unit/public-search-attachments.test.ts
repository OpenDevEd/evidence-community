import { expect, it, vi } from "vitest";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/app/api/cache", () => ({ getCachedCollections: async () => [] }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
const service = vi.hoisted(() => ({ search: vi.fn(), getDisplayedAttributes: async () => ["*"] }));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ index: service }) }));
import { getLibraryConfig } from "@/config/library-config/server";
import { getPublicItems } from "@/lib/search";

it("removes hidden and deleted attachments from full search results used by exports", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	service.search.mockResolvedValue({ estimatedTotalHits: 1, hits: [{
		key: "PUBAAAAA", title: "Published record", attachmentsData: [
			{ key: "VISIBLEA", deleted: 0, tags: [], url: "https://example.org/public.pdf" },
			{ key: "HIDDENAA", deleted: 0, tags: ["Hidden", "_r:doi"], url: "https://doi.org/10.5555/hidden" },
			{ key: "DELETEDD", deleted: 1, tags: [], url: "https://example.org/deleted.pdf" },
		],
	}] });
	const result = await getPublicItems({}, { includeHeavyFields: true });
	expect(result.items[0].attachmentsData).toEqual([
		{ key: "VISIBLEA", deleted: 0, tags: [], url: "https://example.org/public.pdf" },
	]);
});

it("gives list results only the attachments the item page shows, without unpublished note text", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	config.content.tags.publish = ["_publish"];
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	const attachment = { deleted: 0, parentItem: "PUBAAAAA", filename: null, title: null, url: null, PDFCoverPageImage: null, linkMode: null, itemType: "Attachment", note: null, fullTextPDF: [{ text: "body", page: 1 }] };
	service.search.mockResolvedValue({ estimatedTotalHits: 1, hits: [{
		key: "PUBAAAAA", title: "Published record", attachmentsData: [
			{ ...attachment, key: "COVERPDF", tags: [], filename: "report.pdf", PDFCoverPageImage: "cover.png" },
			{ ...attachment, key: "PLAINPDF", tags: [], filename: "draft.pdf" },
			{ ...attachment, key: "DOILINKA", tags: ["_r:doi"], linkMode: "linked_url", url: "https://doi.org/10.5281/zenodo.123" },
			{ ...attachment, key: "PUBNOTEA", itemType: "Note", tags: ["_publish"], note: "<p>Shown</p>" },
			{ ...attachment, key: "PRIVNOTE", itemType: "Note", tags: [], note: "<p>Private</p>" },
			{ ...attachment, key: "HIDNOTEA", itemType: "Note", tags: ["_publish", "hidden"], note: "<p>Hidden</p>" },
		],
	}] });
	const result = await getPublicItems({});
	const common = { parentItem: "PUBAAAAA", itemType: "Attachment", linkMode: null, title: null, filename: null, url: null, PDFCoverPageImage: null, note: null };
	expect(result.items[0].attachmentsData).toEqual([
		{ ...common, key: "COVERPDF", tags: [], filename: "report.pdf", PDFCoverPageImage: "cover.png" },
		{ ...common, key: "DOILINKA", tags: ["_r:doi"], linkMode: "linked_url", url: "https://doi.org/10.5281/zenodo.123" },
		{ ...common, key: "PUBNOTEA", itemType: "Note", tags: ["_publish"], note: "<p>Shown</p>" },
	]);
	expect(service.search.mock.lastCall?.[1].attributesToRetrieve).toContain("attachmentsData");
});
