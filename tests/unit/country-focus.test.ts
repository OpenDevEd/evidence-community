import { describe, expect, it } from "vitest";
import { resolveCountryFocus } from "@/lib/country-focus";
import {
	validateNativeItemDraft,
	sourceRecordValidationOptions,
} from "@/lib/admin/native-item-validation";
import {
	createZoteroItemPatch,
	createZoteroItemPayload,
} from "@/lib/source-writeback/zotero/mapper";

// Country focus is title/abstract inference or an explicit set, never affiliations or patent jurisdiction.
describe("country focus", () => {
	it("detects names and demonyms once across the title and abstract", () => {
		expect(
			resolveCountryFocus({
				title: "Kenyan classrooms in Kenya",
				abstractNote:
					"Feedback in Uganda and Tanzania. Kenyan teachers responded.",
			}),
		).toEqual(["KE", "TZ", "UG"]);
	});
	it("does not interpret ordinary words, institutions or a patent country as focus", () => {
		expect(
			resolveCountryFocus({
				title: "Join us in learning to give feedback",
				abstractNote: "Afghanistanis is not a country name.",
			}),
		).toEqual([]);
		expect(
			resolveCountryFocus({ title: "Attention", abstractNote: "" }),
		).toEqual([]);
	});
	it("matches visible text in rich-text abstracts, ignoring HTML attributes", () => {
		expect(
			resolveCountryFocus({
				abstractNote:
					'<p data-source="Kenya">Evidence from <em>New</em>&nbsp;Zealand and South Sudan.</p>',
			}),
		).toEqual(["NZ", "SS"]);
	});
	it.each([
		["Papua New Guinea", ["PG"]],
		["Guinea-Bissau and Equatorial Guinea", ["GQ", "GW"]],
		["South Sudan", ["SS"]],
		["Democratic Republic of the Congo", ["CD"]],
		["American Samoa", ["AS"]],
		["Dominican Republic", ["DO"]],
		["South Sudan and Sudan", ["SD", "SS"]],
		["Congolese teachers", []],
	])("matches the most specific country names in %s", (title, countries) => {
		expect(resolveCountryFocus({ title })).toEqual(countries);
	});
	it("uses only manual countries, including an explicitly empty selection", () => {
		expect(
			resolveCountryFocus({ title: "Kenya", countryFocus: ["MA"] }),
		).toEqual(["MA"]);
		expect(
			resolveCountryFocus({ title: "Kenya", countryFocus: [] }),
		).toEqual([]);
		expect(
			resolveCountryFocus({ title: "Kenya", countryFocus: null }),
		).toEqual(["KE"]);
	});
	it("normalizes and deduplicates manual countries before they enter a draft or published record", () => {
		const result = validateNativeItemDraft({
			itemType: "report",
			countryFocus: ["ke", "KE", " ug ", "UG"],
		});
		expect(result.payload.countryFocus).toEqual(["KE", "UG"]);
		expect(result.item.countryFocus).toEqual(["KE", "UG"]);
		expect(
			validateNativeItemDraft({ itemType: "report", countryFocus: [] })
				.payload.countryFocus,
		).toEqual([]);
		expect(
			validateNativeItemDraft({ itemType: "report", countryFocus: null })
				.payload,
		).not.toHaveProperty("countryFocus");
	});
	it("rejects invented countries and the wrong value type", () => {
		for (const countryFocus of [["XX"], [123], "KE"]) {
			expect(() =>
				validateNativeItemDraft({ itemType: "report", countryFocus }),
			).toThrow();
		}
	});
	it("keeps library focus separate from source metadata and Zotero writeback", () => {
		const payload = {
			itemType: "report",
			title: "Kenya",
			countryFocus: ["UG"],
		};
		expect(
			validateNativeItemDraft(payload, sourceRecordValidationOptions)
				.item,
		).not.toHaveProperty("countryFocus");
		expect(createZoteroItemPayload(payload, "ABCD2345")).not.toHaveProperty(
			"countryFocus",
		);
		expect(createZoteroItemPatch(payload, ["countryFocus"])).toEqual({});
		const patent = validateNativeItemDraft({
			itemType: "patent",
			country: "GB",
			countryFocus: ["KE"],
		});
		expect(patent.item).toMatchObject({
			country: "GB",
			countryFocus: ["KE"],
		});
	});
});
