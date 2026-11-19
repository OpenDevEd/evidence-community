import { describe, expect, it } from "vitest";
import { validateReviewPayload } from "@/lib/admin/review-validation";
import { AdminValidationError } from "@/lib/admin/errors";
import type { PublishingChoice } from "@/lib/admin/review-contract";
const zenodo: PublishingChoice = {
	route: "zenodo",
	identifierPolicy: "mint-zenodo",
};
const crossref: PublishingChoice = {
	route: "crossref-zenodo",
	identifierPolicy: "reuse-crossref",
};
const report = { itemType: "Report", title: "Learning together", licence: { kind: "zenodo", id: "cc-by-4.0" } };
function blockers(payload: unknown, choice: PublishingChoice | null) {
	try {
		validateReviewPayload(payload, choice);
		return {};
	} catch (error) {
		if (error instanceof AdminValidationError) return error.fields;
		throw error;
	}
}
describe("review publishing requirements", () => {
	it("treats an undefined field from a client patch as absent", () => {
		expect(
			blockers(
				{
					itemType: "Dataset",
					title: "Rainfall records",
					institution: undefined,
					creators: [{ creatorType: "author", name: "Learning Lab" }],
				},
				null,
			),
		).toEqual({});
	});
	it("needs the record's own licence for a DOI, whole when it is one outside Zenodo's list", () => {
		const complete = { ...report, date: "2026-09-10", creators: [{ creatorType: "author", name: "Learning Lab" }] };
		const { licence: _none, ...unlicensed } = complete;
		expect(Object.keys(blockers(unlicensed, zenodo))).toEqual(["licence"]);
		expect(Object.keys(blockers({ ...complete, licence: { kind: "custom", title: "Our terms", url: "", open: true } }, zenodo))).toEqual(["licence"]);
		expect(blockers({ ...complete, licence: { kind: "custom", title: "Our terms", url: "https://example.org/terms", open: true } }, zenodo)).toEqual({});
		// Without a DOI, a record needs no licence.
		expect(blockers(unlicensed, null)).toEqual({});
	});
	it("permits a title-only item when identifiers are disabled", () => {
		expect(blockers(report, null)).toEqual({});
	});
	it("requires Zenodo metadata immediately and also checks Crossref metadata for the combined route", () => {
		expect(Object.keys(blockers(report, zenodo)).sort()).toEqual([
			"creators",
			"date",
		]);
		expect(Object.keys(blockers(report, crossref)).sort()).toEqual([
			"creators",
			"date",
			"institution",
		]);
	});
	it("accepts Zenodo without a PDF, abstract or institution, while Crossref reports require their institution", () => {
		const payload = {
			...report,
			date: "2026-09-10",
			creators: [{ creatorType: "author", name: "Learning Lab" }],
		};
		expect(blockers(payload, zenodo)).toEqual({});
		expect(Object.keys(blockers(payload, crossref))).toEqual([
			"institution",
		]);
		expect(
			blockers({ ...payload, institution: "Learning Lab" }, crossref),
		).toEqual({});
	});
	it("reports provider title, language and impossible date errors on the editable fields", () => {
		const fields = blockers(
			{
				...report,
				title: "Hi",
				date: "2026-02-30",
				language: "zz",
				creators: [{ creatorType: "author", name: "Learning Lab" }],
			},
			zenodo,
		);
		expect(Object.keys(fields).sort()).toEqual([
			"date",
			"language",
			"title",
		]);
	});
});
