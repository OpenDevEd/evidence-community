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
		"blocks %s when the record already has an external DOI",
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
