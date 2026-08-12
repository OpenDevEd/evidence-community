import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	classifyCrossrefActivationDoi,
	CrossrefDoiConflictError,
	ExternalCrossrefDoiError,
} from "@/lib/publication/crossref-activation-service";

describe("Crossref activation DOI classification", () => {
	it("allocates only when every DOI source is empty", () => {
		expect(
			classifyCrossrefActivationDoi(
				{ DOI: null, extra: null, attachments: [] },
				"10.5555",
			),
		).toEqual({ kind: "allocate" });
	});

	it.each([
		[{ DOI: "https://doi.org/10.5555/Library.1" }, ["item.DOI"]],
		[{ extra: "DOI: 10.5555/library.1" }, ["item.extra.DOI"]],
		[
			{
				attachments: [
					{ url: "https://doi.org/10.5555/library.1", tags: ["_r:doi"] },
				],
			},
			["attachment[0]"],
		],
	] as const)("reuses a DOI owned by the configured prefix", (input, sources) => {
		expect(classifyCrossrefActivationDoi(input, "10.5555")).toEqual({
			kind: "reuse",
			doi: "10.5555/library.1",
			sources,
		});
	});

	it("collapses matching DOI sources", () => {
		expect(
			classifyCrossrefActivationDoi(
				{
					DOI: "10.5555/library.1",
					extra: "DOI: https://doi.org/10.5555/library.1",
				},
				"10.5555",
			),
		).toMatchObject({
			kind: "reuse",
			sources: ["item.DOI", "item.extra.DOI"],
		});
	});

	it("rejects conflicting DOI sources", () => {
		expect(() =>
			classifyCrossrefActivationDoi(
				{
					DOI: "10.5555/library.1",
					extra: "DOI: 10.5555/library.2",
				},
				"10.5555",
			),
		).toThrow(CrossrefDoiConflictError);
	});

	it("rejects a DOI owned by another prefix", () => {
		expect(() =>
			classifyCrossrefActivationDoi(
				{ DOI: "10.9999/external" },
				"10.5555",
			),
		).toThrow(ExternalCrossrefDoiError);
	});
});
