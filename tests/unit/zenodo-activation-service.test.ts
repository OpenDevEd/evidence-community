import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	resolveZenodoActivationPolicy,
	type ZenodoActivationPolicyInput,
} from "@/lib/publication/zenodo-activation-service";
import { ZenodoActivationValidationError } from "@/lib/publication/errors";

function input(
	changes: Partial<ZenodoActivationPolicyInput> = {},
): ZenodoActivationPolicyInput {
	return {
		configuredDefault: "reuse-crossref",
		requestedPolicy: undefined,
		bibliographicDoi: null,
		managedCrossref: null,
		...changes,
	};
}

describe("Zenodo activation policy", () => {
	it("uses the configured default when the request omits a policy", () => {
		expect(
			resolveZenodoActivationPolicy(
				input({
					managedCrossref: {
						doi: "10.5555/library.1",
						lifecycle: "verified",
					},
				}),
			),
		).toBe("reuse-crossref");
	});

	it("accepts an explicit Zenodo DOI", () => {
		expect(
			resolveZenodoActivationPolicy(
				input({ requestedPolicy: "mint-zenodo" }),
			),
		).toBe("mint-zenodo");
	});

	it("requires a managed Crossref DOI for reuse", () => {
		expect(() => resolveZenodoActivationPolicy(input())).toThrow(
			ZenodoActivationValidationError,
		);
	});

	it.each(["reuse-crossref", "mint-zenodo"] as const)(
		"blocks %s when the record already has its own DOI",
		(requestedPolicy) => {
			expect(() =>
				resolveZenodoActivationPolicy(
					input({
						requestedPolicy,
						bibliographicDoi: "10.9999/external",
					}),
				),
			).toThrow(ZenodoActivationValidationError);
		},
	);

	it("archives under the record's own DOI when asked to reuse it", () => {
		expect(
			resolveZenodoActivationPolicy(
				input({
					requestedPolicy: "reuse-external",
					bibliographicDoi: "10.9999/external",
				}),
			),
		).toBe("reuse-external");
	});

	it("picks reuse-external by itself when the record has its own DOI and nothing was asked", () => {
		expect(
			resolveZenodoActivationPolicy(
				input({ bibliographicDoi: "10.9999/external" }),
			),
		).toBe("reuse-external");
	});

	it("refuses reuse-external when there is no record DOI to reuse", () => {
		expect(() =>
			resolveZenodoActivationPolicy(
				input({ requestedPolicy: "reuse-external" }),
			),
		).toThrow(ZenodoActivationValidationError);
	});

	it("refuses reuse-external when the record DOI is the one Crossref registered here", () => {
		expect(() =>
			resolveZenodoActivationPolicy(
				input({
					requestedPolicy: "reuse-external",
					bibliographicDoi: "10.5555/library.1",
					managedCrossref: { doi: "10.5555/library.1", lifecycle: "verified" },
				}),
			),
		).toThrow(ZenodoActivationValidationError);
	});

	it("allows the managed Crossref DOI already stored on the record", () => {
		expect(
			resolveZenodoActivationPolicy(
				input({
					bibliographicDoi: "10.5555/library.1",
					managedCrossref: {
						doi: "10.5555/library.1",
						lifecycle: "reserved",
					},
				}),
			),
		).toBe("reuse-crossref");
	});
});

describe("the record DOI must resolve before Zenodo reuses it", () => {
	it("accepts a DOI that doi.org answers for", async () => {
		const { assertDoiResolves } = await import(
			"@/lib/publication/zenodo-activation-service"
		);
		const calls: string[] = [];
		await expect(
			assertDoiResolves("10.9999/external", async (url) => {
				calls.push(url);
				return { ok: true, status: 302 };
			}),
		).resolves.toBeUndefined();
		expect(calls).toEqual(["https://doi.org/10.9999%2Fexternal"]);
	});

	it("refuses a DOI that doi.org does not know", async () => {
		const { assertDoiResolves } = await import(
			"@/lib/publication/zenodo-activation-service"
		);
		await expect(
			assertDoiResolves("10.9999/missing", async () => ({ ok: false, status: 404 })),
		).rejects.toThrow(/does not resolve/u);
	});

	it("refuses when doi.org cannot be reached, instead of archiving blindly", async () => {
		const { assertDoiResolves } = await import(
			"@/lib/publication/zenodo-activation-service"
		);
		await expect(
			assertDoiResolves("10.9999/external", async () => {
				throw new Error("network down");
			}),
		).rejects.toThrow(/could not be checked/u);
	});
});
