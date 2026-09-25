import { describe, expect, it } from "vitest";

import {
	deduplicateImportedTopics,
	mergeTopicPickerSelection,
} from "@/components/admin/TopicsEditor";
import type { TopicNode } from "@/lib/topics/contract";

const topic = (id: `T${number}`): TopicNode => ({
	id,
	name: id,
	parent: "subfields/1",
	level: "topic",
	path: ["Domain", "Field", "Subfield", id],
	childCount: 0,
});

describe("the topic editor", () => {
	it("preserves saved IDs the catalog could not resolve", () => {
		expect(
			mergeTopicPickerSelection(
				["T1", "T999"],
				[topic("T1")],
				[topic("T2")],
			),
		).toEqual(["T2", "T999"]);
		expect(
			mergeTopicPickerSelection(["T1", "T999"], [], []),
		).toEqual(["T1", "T999"]);
	});

	it("shows one imported suggestion per topic", () => {
		expect(
			deduplicateImportedTopics([
				{ topicId: "T1", score: 0.6, primary: false },
				{ topicId: "T2", score: 0.8, primary: false },
				{ topicId: "T1", score: 0.7, primary: true },
			]),
		).toEqual([
			{ topicId: "T1", score: 0.7, primary: true },
			{ topicId: "T2", score: 0.8, primary: false },
		]);
	});
});
