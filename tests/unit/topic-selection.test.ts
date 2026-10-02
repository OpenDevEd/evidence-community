import { describe, expect, it } from "vitest";

import {
	selectionFrontier,
	toggleTopicSelection,
	withoutBareRoots,
	type TopicSelectionNode,
} from "@/lib/topics/selection";

const nodes: TopicSelectionNode[] = [
	{
		id: "domains/3",
		parent: null,
	},
	{
		id: "fields/17",
		parent: "domains/3",
	},
	{
		id: "subfields/1702",
		parent: "fields/17",
	},
	{
		id: "T12260",
		parent: "subfields/1702",
	},
	{
		id: "T13565",
		parent: "subfields/1702",
	},
	{
		id: "domains/2",
		parent: null,
	},
	{
		id: "fields/33",
		parent: "domains/2",
	},
];

describe("topic selection", () => {
	it("uses the most specific selected nodes on each branch", () => {
		expect(
			selectionFrontier(
				[
					"domains/3",
					"fields/17",
					"subfields/1702",
					"T12260",
					"T13565",
					"domains/2",
					"fields/33",
				],
				nodes,
			),
		).toEqual(["T12260", "T13565", "fields/33"]);
	});

	it("adds a node with its ancestors and removes its descendants", () => {
		const selected = toggleTopicSelection([], "T12260", nodes);
		expect(selected).toEqual([
			"domains/3",
			"fields/17",
			"subfields/1702",
			"T12260",
		]);

		expect(
			toggleTopicSelection(
				[...selected, "T13565", "domains/2", "fields/33"],
				"subfields/1702",
				nodes,
			),
		).toEqual(["domains/3", "fields/17", "domains/2", "fields/33"]);
	});

	it("drops unknown URL values from the effective frontier", () => {
		expect(selectionFrontier(["T12260", "unknown"], nodes)).toEqual([
			"T12260",
		]);
	});
});

describe("domains in the topic tree", () => {
	it("drops a domain once nothing under it is chosen", () => {
		const cleared = toggleTopicSelection(["domains/3", "fields/17"], "fields/17", nodes);
		expect(cleared).toEqual(["domains/3"]);
		expect(withoutBareRoots(cleared, nodes)).toEqual([]);
	});

	it("keeps a domain while something under it is chosen, and topics it doesn't know", () => {
		expect(withoutBareRoots(["domains/3", "fields/17", "T99999"], nodes)).toEqual(["domains/3", "fields/17", "T99999"]);
	});
});
