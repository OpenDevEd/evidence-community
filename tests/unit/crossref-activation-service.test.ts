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
			classifyCrossrefActivationDoi({
				DOI: null,
				extra: null,
				attachments: [],
			}),
		).toEqual({ kind: "allocate" });
	});

	it.each([
		[{ DOI: "https://doi.org/10.5555/Library.1" }, ["item.DOI"]],
		[{ extra: "DOI: 10.5555/library.1" }, ["item.extra.DOI"]],
		[
			{
				attachments: [
					{
						url: "https://doi.org/10.5555/library.1",
						tags: ["_r:doi"],
					},
				],
			},
			["attachment[0]"],
		],
	] as const)(
		"rejects a metadata DOI even under the configured prefix",
		(input, _sources) => {
			expect(() => classifyCrossrefActivationDoi(input)).toThrow(
				ExternalCrossrefDoiError,
			);
		},
	);

	it("rejects matching metadata DOI sources as one external DOI", () => {
		expect(() =>
			classifyCrossrefActivationDoi({
				DOI: "10.5555/library.1",
				extra: "DOI: https://doi.org/10.5555/library.1",
			}),
		).toThrow(ExternalCrossrefDoiError);
	});

	it("reuses a DOI only when this item already owns the managed identifier", () => {
		expect(
			classifyCrossrefActivationDoi(
				{ DOI: "10.5555/library.1" },
				"10.5555/library.1",
			),
		).toEqual({
			kind: "reuse",
			doi: "10.5555/library.1",
			sources: ["item.DOI"],
		});
	});

	it("rejects conflicting DOI sources", () => {
		expect(() =>
			classifyCrossrefActivationDoi({
				DOI: "10.5555/library.1",
				extra: "DOI: 10.5555/library.2",
			}),
		).toThrow(CrossrefDoiConflictError);
	});

	it("rejects a DOI owned by another prefix", () => {
		expect(() =>
			classifyCrossrefActivationDoi({ DOI: "10.9999/external" }),
		).toThrow(ExternalCrossrefDoiError);
	});
});
