import { expect, it, vi } from "vitest";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/app/api/auth/[...nextauth]/config", () => ({ auth: vi.fn() }));
vi.mock("@/app/api/cache", () => ({ getCachedCollections: async () => [] }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
const service = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/elasticsearch", () => ({ getSearchForConfig: async () => ({ alias: "library", client: service }) }));
import { getLibraryConfig } from "@/config/library-config/server";
import * as actions from "@/lib/actions";

// Every export of a "use server" file can be called from any browser.
it("lets no server action caller choose search options, so unpublished note text cannot come back", async () => {
	expect(actions).not.toHaveProperty("searchIndex");
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	// The record's publish tags are its Zotero source's.
	const zotero = config.sources.find((source) => source.provider === "zotero")!;
	if (zotero.provider === "zotero") zotero.settings.pdfPublishing = { mode: "tagged", tags: ["_publish"] };
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	service.search.mockResolvedValue({ hits: { total: { value: 1, relation: "eq" }, hits: [{ _source: {
		key: "PUBAAAAA", sourceConnectionKey: zotero.key, attachmentsData: [
			{ key: "PUBNTEAA", deleted: 0, itemType: "Note", tags: ["_publish"], note: "<p>Shown</p>" },
			{ key: "PRIVNTEA", deleted: 0, itemType: "Note", tags: ["_cites"], note: "<p>Private</p>" },
		],
	}, sort: ["PUBAAAAA"] }] } });
	const result = await actions.getItems({});
	if ("refused" in result) throw new Error("A public search was refused");
	expect(result.items[0].attachmentsData?.map((attachment) => attachment.key)).toEqual(["PUBNTEAA"]);
});
