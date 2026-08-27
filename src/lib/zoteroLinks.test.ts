import assert from "node:assert/strict";
import test from "node:test";

import { getZoteroGroupItemLinks } from "./zoteroLinks";

test("builds Zotero desktop and web links from the external group ID", () => {
	assert.deepEqual(
		getZoteroGroupItemLinks({
			groupExternalId: 5724422,
			key: "5MQPEW68",
		}),
		{
			desktop: "zotero://select/groups/5724422/items/5MQPEW68",
			web: "https://www.zotero.org/groups/5724422/items/5MQPEW68",
		}
	);
});

test("does not build Zotero group links for local records", () => {
	assert.equal(
		getZoteroGroupItemLinks({ groupExternalId: 1, key: "LOCAL001" }),
		null
	);
	assert.equal(
		getZoteroGroupItemLinks({ groupExternalId: null, key: "LOCAL002" }),
		null
	);
});
