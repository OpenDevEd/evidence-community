import { describe, expect, it } from "vitest";

import { planItemWritebackLinkChanges } from "@/lib/source-writeback/queue";

const allowed = new Set(["zotero-a", "zotero-b"]);

describe("planItemWritebackLinkChanges", () => {
	it("inserts missing links, enables and disables existing ones", () => {
		expect(
			planItemWritebackLinkChanges({
				allowedSourceKeys: allowed,
				existingLinks: [
					{ sourceConnectionKey: "zotero-a", writebackEnabled: false },
					{ sourceConnectionKey: "zotero-old", writebackEnabled: true },
				],
				sourceKeys: ["zotero-a", "zotero-b"],
			}),
		).toEqual({
			disable: ["zotero-old"],
			enable: ["zotero-a"],
			enabled: ["zotero-a", "zotero-b"],
			insert: ["zotero-b"],
			invalid: [],
			newlyEnabled: ["zotero-a", "zotero-b"],
		});
	});

	it("keeps an already enabled link without listing it as new", () => {
		expect(
			planItemWritebackLinkChanges({
				allowedSourceKeys: allowed,
				existingLinks: [
					{ sourceConnectionKey: "zotero-a", writebackEnabled: true },
				],
				sourceKeys: ["zotero-a"],
			}),
		).toMatchObject({
			disable: [],
			enable: [],
			enabled: ["zotero-a"],
			insert: [],
			newlyEnabled: [],
		});
	});

	it("rejects unknown or writeback-disabled sources and native", () => {
		expect(
			planItemWritebackLinkChanges({
				allowedSourceKeys: allowed,
				existingLinks: [],
				sourceKeys: ["zotero-a", "native", "mendeley-x", "zotero-a"],
			}),
		).toMatchObject({
			enabled: ["zotero-a"],
			insert: ["zotero-a"],
			invalid: ["native", "mendeley-x"],
		});
	});

	it("disables everything when nothing is selected but keeps the links", () => {
		expect(
			planItemWritebackLinkChanges({
				allowedSourceKeys: allowed,
				existingLinks: [
					{ sourceConnectionKey: "zotero-a", writebackEnabled: true },
					{ sourceConnectionKey: "zotero-b", writebackEnabled: false },
				],
				sourceKeys: [],
			}),
		).toEqual({
			disable: ["zotero-a"],
			enable: [],
			enabled: [],
			insert: [],
			invalid: [],
			newlyEnabled: [],
		});
	});
});
