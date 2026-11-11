import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ownInstitutions } from "@/lib/search";

// A record's institution facet counts every author's institutions, so a top author with one record took a co-author's.
it("counts only the institutions a top author is listed with on their own results", () => {
	const hits = [
		{ creators: [
			{ creatorType: "author" as const, name: "Nadia Recheckeleven", institutions: [{ display_name: "University of Ghana" }] },
			{ creatorType: "author" as const, name: "Ibrahim Recheckeleven", institutions: [{ display_name: "University of Oxford" }] },
		] },
		{ creators: [{ creatorType: "author" as const, name: "Nadia Recheckeleven", institutions: [{ display_name: "University of Ghana" }, { display_name: "University of Cape Town" }] }] },
	];
	expect(ownInstitutions(hits, "Nadia Recheckeleven")).toEqual({ "University of Ghana": 2, "University of Cape Town": 1 });
	expect(ownInstitutions(hits, "Ibrahim Recheckeleven")).toEqual({ "University of Oxford": 1 });
});
