import { describe, expect, it } from "vitest";

import {
	resolveAdminPublicationProviderState,
	type AdminPublicationStateInput,
} from "@/lib/publication/admin-publication-state";

const base: AdminPublicationStateInput = {
	provider: "crossref",
	configured: true,
	targetActive: true,
	blockers: [],
	plan: { status: "write_required" },
	job: null,
	pending: false,
	journal: false,
	failure: false,
	waitingOn: null,
};

describe("admin publication provider state", () => {
	it.each([
		["disabled config", { configured: false }, "blocked"],
		["validation blocker", { blockers: ["Add a title"] }, "blocked"],
		["inactive target", { targetActive: false }, "inactive"],
		[
			"missing file",
			{
				provider: "zenodo",
				plan: { status: "waiting_for_file" },
				waitingOn: "file",
			},
			"waiting",
		],
		[
			"reserved Crossref dependency",
			{ provider: "zenodo", waitingOn: "crossref" },
			"waiting",
		],
		[
			"active lease",
			{
				job: {
					attempts: 0,
					deadLetteredAt: null,
					leaseExpiresAt: new Date("2026-08-12T13:05:00Z"),
					leaseOwner: "worker",
					nextAttemptAt: new Date("2026-08-12T13:00:00Z"),
					processedAt: null,
					supersededAt: null,
				},
			},
			"working",
		],
		["Crossref pending", { pending: true }, "verifying"],
		["Zenodo journal", { provider: "zenodo", journal: true }, "verifying"],
		[
			"scheduled retry",
			{
				job: {
					attempts: 2,
					deadLetteredAt: null,
					leaseExpiresAt: null,
					leaseOwner: null,
					nextAttemptAt: new Date("2026-08-12T13:10:00Z"),
					processedAt: null,
					supersededAt: null,
				},
			},
			"retrying",
		],
		[
			"queued",
			{
				job: {
					attempts: 0,
					deadLetteredAt: null,
					leaseExpiresAt: null,
					leaseOwner: null,
					nextAttemptAt: new Date("2026-08-12T13:00:00Z"),
					processedAt: null,
					supersededAt: null,
				},
			},
			"queued",
		],
		[
			"dead letter",
			{
				job: {
					attempts: 8,
					deadLetteredAt: new Date("2026-08-12T13:00:00Z"),
					leaseExpiresAt: null,
					leaseOwner: null,
					nextAttemptAt: new Date("2026-08-12T13:00:00Z"),
					processedAt: null,
					supersededAt: null,
				},
			},
			"failed",
		],
		["matching provider", { plan: { status: "noop" } }, "synced"],
		["provider failure without a current job", { failure: true }, "failed"],
		["missing repair job", {}, "repair_pending"],
	] as const)("resolves %s", (_label, changes, expected) => {
		expect(
			resolveAdminPublicationProviderState(
				{ ...base, ...changes } as AdminPublicationStateInput,
				new Date("2026-08-12T13:00:00Z"),
			),
		).toBe(expected);
	});

	it("ignores a superseded failed job", () => {
		expect(
			resolveAdminPublicationProviderState({
				...base,
				plan: { status: "noop" },
				job: {
					attempts: 8,
					deadLetteredAt: new Date("2026-08-12T13:00:00Z"),
					leaseExpiresAt: null,
					leaseOwner: null,
					nextAttemptAt: new Date("2026-08-12T13:00:00Z"),
					processedAt: null,
					supersededAt: new Date("2026-08-12T13:01:00Z"),
				},
			}),
		).toBe("synced");
	});
});
