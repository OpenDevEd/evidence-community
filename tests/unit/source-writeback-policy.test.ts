import { describe, expect, it } from "vitest";

import {
	evaluateSourceWritebackPolicy,
	type SourceWritebackReason,
} from "@/lib/source-writeback/policy";

const enabledConfig = {
	sources: [{ key: "zotero-test", writebackEnabled: true }],
};

function zoteroLink(
	overrides: Partial<
		Parameters<typeof evaluateSourceWritebackPolicy>[0]
	> = {},
) {
	return {
		externalScopeKey: "6632364",
		itemEnabled: true,
		provider: "zotero" as const,
		sourceKey: "zotero-test",
		sourceStatus: "active" as const,
		...overrides,
	};
}

describe("item writeback policy", () => {
	it("requires a linked item", () => {
		expect(
			evaluateSourceWritebackPolicy(null, enabledConfig),
		).toMatchObject({
			effective: false,
			reason: "not-linked",
		});
	});

	it("allows active supported links enabled at both levels", () => {
		expect(
			evaluateSourceWritebackPolicy(zoteroLink(), enabledConfig),
		).toMatchObject({
			effective: true,
			itemEnabled: true,
			reason: "ok",
			sourceEnabled: true,
			supported: true,
		});
	});

	const unavailableCases: Array<
		[
			SourceWritebackReason,
			NonNullable<Parameters<typeof evaluateSourceWritebackPolicy>[0]>,
			{ sources: Array<{ key: string; writebackEnabled: boolean }> },
		]
	> = [
		["source-disabled", zoteroLink(), { sources: [] }],
		["item-locked", zoteroLink({ itemEnabled: false }), enabledConfig],
		[
			"source-paused",
			zoteroLink({ sourceStatus: "paused" }),
			enabledConfig,
		],
		[
			"source-removed",
			zoteroLink({ sourceStatus: "removed" }),
			enabledConfig,
		],
		[
			"unsupported-provider",
			zoteroLink({ provider: "mendeley" }),
			enabledConfig,
		],
	];

	it.each(unavailableCases)("reports %s", (reason, link, config) => {
		expect(evaluateSourceWritebackPolicy(link, config)).toMatchObject({
			effective: false,
			reason,
		});
	});

	it("uses provider and source lifecycle precedence", () => {
		expect(
			evaluateSourceWritebackPolicy(
				zoteroLink({
					itemEnabled: false,
					provider: "mendeley",
					sourceStatus: "removed",
				}),
				{ sources: [] },
			),
		).toMatchObject({ reason: "unsupported-provider" });
	});
});
