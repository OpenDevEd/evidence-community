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
