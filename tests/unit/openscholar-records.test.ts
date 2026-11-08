import { describe, expect, it } from "vitest";

import { toOpenScholarRecord } from "@/lib/openscholar/records";

const base = { key: "ADDED001", revision: 1, itemType: "journalArticle", title: "Coaching teachers", abstractNote: null, creators: [], year: "2021", date: null, publicationTitle: null, url: null, DOI: "10.1000/W7" };

describe("a record as Openscholar reads it", () => {
	it("gives an added paper's OpenAlex work, which its source link holds, not its own key", () => {
		expect(toOpenScholarRecord({ ...base, provider: "added", sourceRecordKey: "ADDED001", openalexId: "W7" } as never).crossRefs).toEqual({ openalexId: "W7", doi: "10.1000/w7" });
	});

	it("still reads the work from an OpenAlex record's own key in a document indexed before the field", () => {
		expect(toOpenScholarRecord({ ...base, provider: "openalex", sourceRecordKey: "W9" } as never).crossRefs).toEqual({ openalexId: "W9", doi: "10.1000/w7" });
	});
});
