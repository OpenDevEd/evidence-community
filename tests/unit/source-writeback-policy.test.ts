import { describe, expect, it } from "vitest";

import {
	buildItemWritebackTargets,
	evaluateSourceWritebackPolicy,
	findWritebackTarget,
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

describe("item writeback targets", () => {
	const config = {
		sources: [
			{ key: "zotero-a", writebackEnabled: true },
			{ key: "zotero-b", writebackEnabled: true },
			{ key: "zotero-readonly", writebackEnabled: false },
		],
	};
	const connection = (
		key: string,
		overrides: Partial<{
			externalScopeKey: string | null;
			provider: "mendeley" | "native" | "zotero";
			status: "active" | "paused" | "removed";
		}> = {},
	) => ({
		externalScopeKey: key.replace("zotero-", "group-"),
		key,
		provider: "zotero" as const,
		status: "active" as const,
		...overrides,
	});
	const connections = [
		connection("native", { externalScopeKey: null, provider: "native" }),
		connection("zotero-readonly"),
		connection("zotero-b"),
		connection("zotero-a"),
	];

	it("lists every writeback source in config order with nothing selected for a native record", () => {
		const targets = buildItemWritebackTargets({
			config,
			connections,
			links: [],
			originSourceKey: "native",
		});
		expect(targets.available.map((target) => target.sourceKey)).toEqual([
			"zotero-a",
			"zotero-b",
		]);
		expect(targets.selected).toEqual([]);
		expect(targets.originSourceKey).toBeNull();
		expect(targets.available[0]).toMatchObject({
			effective: false,
			isOrigin: false,
			itemEnabled: false,
			linkExists: false,
			provider: "zotero",
			reason: "not-linked",
			sourceEnabled: true,
			sourceLabel: expect.stringMatching(/Zotero.*group-a/),
		});
	});

	it("marks the origin and the selected sources from the links", () => {
		const targets = buildItemWritebackTargets({
			config,
			connections,
			links: [
				{ sourceConnectionKey: "zotero-b", writebackEnabled: true },
				{ sourceConnectionKey: "zotero-a", writebackEnabled: false },
			],
			originSourceKey: "zotero-b",
		});
		expect(targets.originSourceKey).toBe("zotero-b");
		expect(targets.selected).toEqual(["zotero-b"]);
		expect(targets.available.map((target) => [target.sourceKey, target.isOrigin, target.itemEnabled, target.reason])).toEqual([
			["zotero-a", false, false, "item-locked"],
			["zotero-b", true, true, "ok"],
		]);
	});

	it("shows a linked source that is turned off in library settings, but hides unlinked ones", () => {
		const targets = buildItemWritebackTargets({
			config,
			connections,
			links: [
				{ sourceConnectionKey: "zotero-readonly", writebackEnabled: true },
			],
			originSourceKey: "zotero-readonly",
		});
		expect(targets.available.map((target) => target.sourceKey)).toEqual([
			"zotero-a",
			"zotero-b",
			"zotero-readonly",
		]);
		expect(targets.available[2]).toMatchObject({
			effective: false,
			isOrigin: true,
			linkExists: true,
			reason: "source-disabled",
			sourceEnabled: false,
		});
		expect(targets.selected).toEqual(["zotero-readonly"]);
	});

	it("skips removed and unsupported sources unless the record links to them", () => {
		const targets = buildItemWritebackTargets({
			config: {
				sources: [
					{ key: "zotero-a", writebackEnabled: true },
					{ key: "mendeley-x", writebackEnabled: true },
					{ key: "zotero-gone", writebackEnabled: true },
				],
			},
			connections: [
				connection("zotero-a"),
				connection("mendeley-x", { provider: "mendeley" }),
				connection("zotero-gone", { status: "removed" }),
			],
			links: [{ sourceConnectionKey: "zotero-gone", writebackEnabled: true }],
			originSourceKey: "zotero-gone",
		});
		expect(targets.available.map((target) => [target.sourceKey, target.reason])).toEqual([
			["zotero-a", "not-linked"],
			["zotero-gone", "source-removed"],
		]);
		expect(targets.selected).toEqual(["zotero-gone"]);
	});

	it("finds a target by key", () => {
		const targets = buildItemWritebackTargets({
			config,
			connections,
			links: [],
			originSourceKey: "native",
		});
		expect(findWritebackTarget(targets, "zotero-b")?.sourceKey).toBe("zotero-b");
		expect(findWritebackTarget(targets, "missing")).toBeNull();
	});
});
