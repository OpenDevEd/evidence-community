import { expect, it } from "vitest";
import {
	formatInstitutionNames,
	hasInstitution,
	parseInstitutionNames,
} from "@/config/library-config/institutions";
import { normalizeAdminFieldValue } from "@/lib/admin/field-contract";

it("round-trips multiple Zotero institutions without empty or duplicate names", () => {
	const names = parseInstitutionNames(
		" University of Minnesota | | University of Oxford | university of minnesota ",
	);
	expect(names).toEqual(["University of Minnesota", "University of Oxford"]);
	expect(formatInstitutionNames(names)).toBe(
		"University of Minnesota | University of Oxford",
	);
	expect(parseInstitutionNames(formatInstitutionNames(names))).toEqual(names);
	expect(parseInstitutionNames("")).toEqual([]);
});

it("checks membership for the named institution and re-enables it after removal", () => {
	const names = ["University of Minnesota", "University of Oxford"];
	expect(hasInstitution(names, " university of MINNESOTA ")).toBe(true);
	expect(hasInstitution(names, "University of Cambridge")).toBe(false);
	expect(hasInstitution(names.slice(1), "University of Minnesota")).toBe(
		false,
	);
});

it("normalizes institution lists at the item write boundary without rewriting ordinary publishers", () => {
	for (const field of ["institution", "university"]) {
		expect(
			normalizeAdminFieldValue(
				{ field, semanticField: "publisher", type: "text" },
				" A | B | a ",
			).value,
		).toBe("A | B");
	}
	expect(
		normalizeAdminFieldValue(
			{ field: "publisher", semanticField: "publisher", type: "text" },
			" A | B | a ",
		).value,
	).toBe("A | B | a");
});
