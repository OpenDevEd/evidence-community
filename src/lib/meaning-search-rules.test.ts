import assert from "node:assert/strict";
import { test } from "node:test";
import { listedMeaningKeys } from "./meaning-search-rules";

const ranked = (count: number) => Array.from({ length: count }, (_, rank) => `K${rank}`);

test("a meaning search lists every word match, however low it ranks", () => {
	// 60 word matches spread down a ranking of 200: the closest 60 records, plus the word matches below them.
	const keys = ranked(200);
	const usingWords = new Set(keys.filter((_, rank) => rank % 3 === 0 && rank < 180));
	const listed = listedMeaningKeys(keys, usingWords);
	for (const key of usingWords) assert.ok(listed.includes(key), `${key} uses the words but was dropped`);
	assert.equal(listed.filter((key) => !usingWords.has(key)).length, 40);
	assert.deepEqual(listed, keys.filter((key, rank) => rank < 60 || usingWords.has(key)));
});

test("a search with few word matches lists the closest 50", () => {
	const keys = ranked(300);
	const listed = listedMeaningKeys(keys, new Set(["K120"]));
	assert.deepEqual(listed, [...keys.slice(0, 50), "K120"]);
});
