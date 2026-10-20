import { describe, expect, it } from "vitest";
import {
	countryFocusOptions,
	findCountryFocusOptions,
	resolveCountryFocus,
} from "@/lib/country-focus";
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
	it("offers each named country once", () => {
		const names = countryFocusOptions.map(({ name }) => name);
		expect(new Set(names).size).toBe(names.length);
	});
	it("resolves every selectable country name to its own code", () => {
		for (const { code, name } of countryFocusOptions) {
			expect(resolveCountryFocus({ title: name }), name).toEqual([code]);
		}
	});
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
		["Education in Curaçao", ["CW"]],
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
	it.each([
		["Naoero and Nauru", ["NR"]],
		["Cabo Verde and Cape Verde", ["CV"]],
		["TÜRKİYE, Turkiye and Turkey", ["TR"]],
		["Swaziland and Eswatini", ["SZ"]],
		["Czech Republic and Czechia", ["CZ"]],
		["FYROM and North Macedonia", ["MK"]],
		["Cote d'Ivoire and Côte d’Ivoire", ["CI"]],
		["São Tomé & Príncipe", ["ST"]],
		["Timor–Leste and Timor Leste", ["TL"]],
		["DRC and Congo–Kinshasa", ["CD"]],
		["Republic of the Congo", ["CG"]],
		["U.S.A., U.S. and United States of America", ["US"]],
		["U.K. and Northern Ireland", ["GB"]],
		["U.A.E.", ["AE"]],
		["DPRK and Republic of Korea", ["KP", "KR"]],
		["Kenyans, Ugandans, Moroccans and Nauruans", ["KE", "MA", "NR", "UG"]],
		[
			"Czechs, Danes, Finns, Swedes and Turks",
			["CZ", "DK", "FI", "SE", "TR"],
		],
		["South Koreans and American Samoans", ["AS", "KR"]],
		["U.S. Virgin Islands", ["VI"]],
		["Congo and Congolese teachers", []],
		["Dominicans and Samoans", []],
		["A kiwi weighs 3 oz. Join us in class.", []],
		["English-language instruction in Kenya", ["KE"]],
	])(
		"recognizes current names and useful aliases in %s",
		(title, countries) => {
			expect(resolveCountryFocus({ title })).toEqual(countries);
		},
	);
	// Phrases that put Luxembourg, Jersey, Niger or the US at the top of a library's map without being about them.
	it.each([
		["Harmonized microdata from the Luxembourg Income Study for 30 countries", []],
		["Proceedings. Riga, Latvia: Baltija Publishing", []],
		["Flood risk in New Jersey and British Columbia", []],
		["Farmers in the Niger Delta and Niger State, Nigeria", ["NG"]],
		["Guinea savannah maize near the Gulf of Guinea", []],
		["Monsoon rainfall over the Indian Ocean", []],
		["A Siamese network scores essays from Mechanical Turk workers", []],
		["Holland's RIASEC theory among Scots pine foresters", []],
		["Made possible by the United States Agency for International Development in Kenya", ["KE"]],
		["Teaching Chinese as a second language in Thai Nguyen, Vietnam", ["VN"]],
		["Latin American and Central African countries", []],
		["Students polish their essays with AI", []],
		["Rural American Indian students", ["US"]],
		["Essay scoring in Brazilian Portuguese", ["BR"]],
		["Polish teachers and schools in Luxembourg", ["LU", "PL"]],
	])("does not read a country into a phrase that names something else: %s", (title, countries) => {
		expect(resolveCountryFocus({ title })).toEqual(countries);
	});
	it("keeps the title and abstract from becoming one country name", () => {
		expect(
			resolveCountryFocus({
				title: "Learning in the South",
				abstractNote: "Sudan is the focus.",
			}),
		).toEqual(["SD"]);
	});
	it.each([
		["Nauru", "NR"],
		["Naoero", "NR"],
		["Cape Verde", "CV"],
		["Turkiye", "TR"],
		["Turkey", "TR"],
		["Cote d'Ivoire", "CI"],
		["Curacao", "CW"],
		["FYROM", "MK"],
		["D.R.C.", "CD"],
		["English", "GB"],
	])(
		"finds a single current country using %s and excludes it once selected",
		(query, code) => {
			expect(
				findCountryFocusOptions(query).map((country) => country.code),
			).toEqual([code]);
			expect(findCountryFocusOptions(query, [code])).toEqual([]);
		},
	);
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
		for (const countryFocus of [["XX"], ["AN"], [123], "KE"]) {
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
