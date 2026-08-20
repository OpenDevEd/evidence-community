import { describe, expect, it } from "vitest";

import { planRelationTabs } from "@/components/features/newlib/relation-tabs";

describe("planRelationTabs", () => {
	it("builds three tabs from record links plus provider same-as keys", () => {
		const plan = planRelationTabs({
			activeTab: "cites",
			links: {
				cites: ["AAAA2345"],
				citedBy: ["BBBB2345", "CCCC2345"],
				related: ["DDDD2345"],
			},
			relations: {
				"owl:sameAs": "http://zotero.org/groups/1/items/EEEE2345",
				related_works: ["https://openalex.org/W1", "FFFF2345"],
			},
		});
		expect(plan.tabs.map((tab) => tab.key)).toEqual(["general", "cites", "citedBy"]);
		expect(plan.tabs[0]!.keys).toEqual(["DDDD2345", "EEEE2345", "W1", "FFFF2345"]);
		expect(plan.tabs[1]!.keys).toEqual(["AAAA2345"]);
		expect(plan.tabs[2]!.keys).toEqual(["BBBB2345", "CCCC2345"]);
		expect(plan.activeTab).toBe("cites");
	});

	it("hides empty tabs and falls back to the first visible tab", () => {
		const plan = planRelationTabs({
			activeTab: "general",
			links: { cites: [], citedBy: ["BBBB2345"], related: [] },
			relations: undefined,
		});
		expect(plan.tabs.map((tab) => tab.key)).toEqual(["citedBy"]);
		expect(plan.activeTab).toBe("citedBy");
	});

	it("keeps one tab when nothing is linked", () => {
		const plan = planRelationTabs({
			activeTab: "citedBy",
			links: undefined,
			relations: undefined,
		});
		expect(plan.tabs.map((tab) => tab.key)).toEqual(["general"]);
		expect(plan.tabs[0]!.keys).toEqual([]);
		expect(plan.activeTab).toBe("general");
	});

	it("does not list the same key twice in related resources", () => {
		const plan = planRelationTabs({
			activeTab: "general",
			links: { cites: [], citedBy: [], related: ["DDDD2345"] },
			relations: { "owl:sameAs": ["http://zotero.org/users/2/items/DDDD2345"] },
		});
		expect(plan.tabs[0]!.keys).toEqual(["DDDD2345"]);
	});
});
