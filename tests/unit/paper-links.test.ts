import { describe, expect, it } from "vitest";

import { paperLinkOf } from "@/lib/paper-links";

describe("a paper someone pastes into the community", () => {
	it("is named by Openscholar's paper pages, its own works and communities' records, as by DOIs and OpenAlex", () => {
		expect(paperLinkOf("https://dev.openscholar.ai/papers/W2565346880/relationships-between-teachers")).toEqual({ kind: "work", openalexId: "W2565346880" });
		expect(paperLinkOf("(https://openscholar.ai/papers/OS79563844).")).toEqual({ kind: "own", work: "OS79563844" });
		expect(paperLinkOf("https://wealth-inequality.openscholar.ai/lib/ABCD2345")).toEqual({ kind: "record", origin: "https://wealth-inequality.openscholar.ai", itemKey: "ABCD2345" });
		expect(paperLinkOf("https://openalex.org/W2126314681")).toEqual({ kind: "work", openalexId: "W2126314681" });
		expect(paperLinkOf("https://doi.org/10.1016/j.tate.2015.06.010.")).toEqual({ kind: "doi", doi: "10.1016/j.tate.2015.06.010" });
		expect(paperLinkOf("https://example.org/papers/W1/a-title")).toBeNull();
	});
});
