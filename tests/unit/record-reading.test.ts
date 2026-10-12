import { describe, expect, it } from "vitest";
import { metadataStudyType } from "@/lib/readings/metadata-type";
import { QUESTION_SET, gradeOf, readingAnswers, readingQuestions } from "@/lib/readings/questions";
import { planRead } from "@/lib/readings/worker";

const record = { key: "AAAA1111", title: "Heat and maize yields", abstract: "We pooled 40 trials.", pdf: "", itemType: "JournalArticle", openAlexType: "article", doi: null, sources: ["oa"] };
const climate = { key: "oa", subject: "Climate adaptation", hash: "climate" };
/** What a whole read of `record` stored, as Jev typed it. */
const readAs = (contentHash: string, questionSet = QUESTION_SET) => ({ contentHash, questionSet, studyType: "meta-analysis" as const, typedBy: "ai" as const, typeConfidence: 0.9, input: "abstract" as const });

describe("what a record's own metadata says it is", () => {
	it("types datasets, software, corrections, editorials and registered protocols without asking Jev", () => {
		expect(metadataStudyType({ itemType: "Dataset", openAlexType: null, doi: null })).toBe("not-research");
		expect(metadataStudyType({ itemType: "JournalArticle", openAlexType: "erratum", doi: null })).toBe("not-research");
		expect(metadataStudyType({ itemType: "JournalArticle", openAlexType: "editorial", doi: null })).toBe("commentary");
		expect(metadataStudyType({ itemType: "Report", openAlexType: null, doi: "https://doi.org/10.37766/inplasy2026.9.0012" })).toBe("protocol");
		expect(metadataStudyType({ itemType: "JournalArticle", openAlexType: "article", doi: "10.1000/xyz" })).toBeNull();
	});
});

describe("planning a read", () => {
	it("reads a new record whole and grades it against each of its screening sources", () => {
		const plan = planRead(record, { grades: new Map() }, [climate]);
		expect(plan?.ask).toEqual({ type: true, details: true, subjects: ["Climate adaptation"] });
	});

	it("asks nothing when the text, question set and subject are what the record was read with", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		expect(planRead(record, { reading: readAs(first.contentHash), grades: new Map([["oa", ["climate", null]]]) }, [climate])).toBeNull();
	});

	it("asks only the grade when a source's subject changed", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		const plan = planRead(record, { reading: readAs(first.contentHash), grades: new Map([["oa", ["old subject", null]]]) }, [climate]);
		expect(plan?.ask).toEqual({ type: false, details: false, subjects: ["Climate adaptation"] });
	});

	it("reads the record whole again when its text or the question set changed", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		const stored = { reading: readAs(first.contentHash, QUESTION_SET - 1), grades: new Map([["oa", ["climate", null]]]) };
		expect(planRead(record, stored, [climate])?.ask.details).toBe(true);
		expect(planRead({ ...record, abstract: "A new abstract." }, { ...stored, reading: { ...stored.reading, questionSet: QUESTION_SET } }, [climate])?.ask.details).toBe(true);
	});

	it("asks at most eight grades in one call and leaves the rest for the next", () => {
		const many = Array.from({ length: 10 }, (_, index) => ({ key: `s${index}`, subject: `Subject ${index}`, hash: `h${index}` }));
		const plan = planRead(record, { grades: new Map() }, many);
		expect(plan?.ask.subjects).toHaveLength(8);
		expect(plan?.more).toBe(true);
	});

	it("asks no grade the record already has, or has pending, against the source's subject", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		expect(planRead(record, { reading: readAs(first.contentHash), grades: new Map([["oa", ["old subject", "climate"]]]) }, [climate])).toBeNull();
	});

	it("asks the type again from the PDF when the abstract left Jev unsure, and only once", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		const unsure = { ...readAs(first.contentHash), typeConfidence: 0.4 };
		const graded = new Map([["oa", ["climate", null]]]);
		expect(planRead(record, { reading: unsure, grades: graded }, [climate])).toBeNull();
		expect(planRead({ ...record, pdf: "Methods. We searched five databases." }, { reading: unsure, grades: graded }, [climate]))
			.toMatchObject({ pdf: true, ask: { type: true, details: false, subjects: [] } });
		expect(planRead({ ...record, pdf: "Methods." }, { reading: { ...unsure, input: "pdf" }, grades: graded }, [climate])).toBeNull();
	});

	it("does not ask the type of a record its metadata types", () => {
		expect(planRead({ ...record, itemType: "Dataset" }, { grades: new Map() }, [climate])?.ask.type).toBe(false);
	});

	it("retypes a record whose metadata changed, without a call when the metadata now gives the type", () => {
		const first = planRead(record, { grades: new Map() }, [climate])!;
		const graded = new Map([["oa", ["climate", null]]]);
		const nowDataset = planRead({ ...record, itemType: "Dataset" }, { reading: readAs(first.contentHash), grades: graded }, [climate]);
		expect(nowDataset).toMatchObject({ retype: true, metadataType: "not-research", ask: { type: false, details: false, subjects: [] } });
		const noLongerDataset = planRead(record, { reading: { ...readAs(first.contentHash), studyType: "not-research", typedBy: "metadata" }, grades: graded }, [climate]);
		expect(noLongerDataset?.ask).toEqual({ type: true, details: false, subjects: [] });
	});
});

describe("questions and answers", () => {
	it("asks one grade question per subject, and the type and details only when asked", () => {
		expect(Object.keys(readingQuestions({ type: true, details: true, subjects: ["a", "b"] }))).toEqual(["type", "pooled", "region", "effects", "grade_0", "grade_1"]);
		expect(Object.keys(readingQuestions({ type: false, details: false, subjects: ["a"] }))).toEqual(["grade_0"]);
	});

	it("reads Jev's answers into what is stored, taking a choice's probability when it gives no confidence", () => {
		const read = readingAnswers({ type: true, details: true, subjects: ["a"] }, {
			type: { type: "choice", choice: "meta-analysis", probabilities: { "meta-analysis": 0.82 } },
			pooled: { type: "noul", noul: 0.9 },
			region: { type: "choice", choice: "south-asia", confidence: 0.7 },
			effects: { type: "noul", noul: 0.95 },
			grade_0: { type: "score", score: 2.6 },
		});
		expect(read).toEqual({ type: { key: "meta-analysis", confidence: 0.82 }, details: { pooled: 0.9, region: "south-asia", effects: 0.95 }, scores: [2.6] });
	});

	it("refuses a missing or unknown answer, so the read is tried again", () => {
		expect(() => readingAnswers({ type: false, details: false, subjects: ["a"] }, {})).toThrow();
		expect(() => readingAnswers({ type: true, details: false, subjects: [] }, { type: { type: "choice", choice: "novel" } })).toThrow();
	});

	it("puts a score on the nearest grade", () => {
		expect([0.4, 0.6, 1.4, 2.5, 3].map(gradeOf)).toEqual(["not-about", "passing", "passing", "about", "about"]);
	});
});
