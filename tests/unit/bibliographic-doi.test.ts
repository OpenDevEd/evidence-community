import { describe, expect, it } from "vitest";

import { resolveBibliographicDoi } from "@/lib/publication/bibliographic-doi";

describe("resolveBibliographicDoi", () => {
	it("normalizes a DOI from the canonical item field", () => {
		expect(
			resolveBibliographicDoi({
				DOI: "https://doi.org/10.1234/Example",
			}),
		).toEqual({
			status: "resolved",
			doi: "10.1234/example",
			sources: ["item.DOI"],
			conflicts: [],
		});
	});

	it("resolves matching values from the item, Extra, and DOI attachments", () => {
		expect(
			resolveBibliographicDoi({
				DOI: "10.1234/example",
				extra: "DOI: https://doi.org/10.1234/EXAMPLE",
				attachments: [
					{
						url: "https://doi.org/10.1234/example",
						tags: ["_r:doi"],
					},
				],
			}),
		).toEqual({
			status: "resolved",
			doi: "10.1234/example",
			sources: ["item.DOI", "item.extra.DOI", "attachment[0]"],
			conflicts: [],
		});
	});

	it("reports every valid conflicting DOI instead of choosing one", () => {
		expect(
			resolveBibliographicDoi({
				DOI: "10.1234/one",
				extra: "doi: 10.1234/two",
				attachments: [
					{
						url: "https://doi.org/10.1234/three",
						tags: ["_R:DOI"],
					},
				],
			}),
		).toEqual({
			status: "conflict",
			doi: null,
			sources: [],
			conflicts: [
				{ source: "item.DOI", doi: "10.1234/one" },
				{ source: "item.extra.DOI", doi: "10.1234/two" },
				{ source: "attachment[0]", doi: "10.1234/three" },
			],
		});
	});

	it("does not treat Zenodo archive DOIs as conflicting bibliographic DOIs", () => {
		expect(
			resolveBibliographicDoi({
				DOI: "10.1234/article",
				extra: "DOI: 10.5281/zenodo.123",
				attachments: [
					{
						url: "https://doi.org/10.5281/zenodo.456",
						tags: ["_r:doi"],
					},
				],
			}),
		).toEqual({
			status: "resolved",
			doi: "10.1234/article",
			sources: ["item.DOI"],
			conflicts: [],
		});
	});

	it("ignores invalid values and untagged attachments", () => {
		expect(
			resolveBibliographicDoi({
				DOI: "not a DOI",
				extra: "DOI: also-not-a-doi",
				attachments: [
					{
						url: "https://doi.org/10.1234/ignored",
						tags: ["link"],
					},
				],
			}),
		).toEqual({
			status: "none",
			doi: null,
			sources: [],
			conflicts: [],
		});
	});
});
