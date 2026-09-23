import { describe, expect, it } from "vitest";
import { topicPaths } from "@/app/[locale]/statistics/queries/topic-stats";

const shown = new Map([
	["EDU", { title: "Education" }],
	["LIT", { title: "Literacy / reading", parent: "EDU" }],
]);

describe("topic paths", () => {
	it("names a shown collection by its titles, from the top", () => {
		expect(topicPaths("LIT", shown).map((path) => [path.topic, path.level, path.parentTopic])).toEqual([
			["Education", 1, undefined],
			["Literacy / reading", 2, "Education"],
		]);
	});

	it("tells apart collections that share a title by their keys", () => {
		const twins = new Map([["A", { title: "Education" }], ["B", { title: "Education" }]]);
		expect([topicPaths("A", twins)[0]?.id, topicPaths("B", twins)[0]?.id]).toEqual(["A", "B"]);
		expect(topicPaths("LIT", shown).map((path) => [path.id, path.parentId])).toEqual([["EDU", undefined], ["EDU/LIT", "EDU"]]);
	});

	it("leaves out a collection the library does not show", () => {
		expect(topicPaths("INTERNAL", shown)).toEqual([]);
	});

	it("keeps a title with a slash as one topic", () => {
		expect(topicPaths("LIT", shown).at(-1)?.fullPath.split(" › ")).toEqual(["Education", "Literacy / reading"]);
	});
});
