import { describe, expect, it } from "vitest";

import {
	describeAdminPublicationProviderState,
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
	externalDoi: null,
};

describe("admin publication provider state", () => {
	it.each([
		["blocked", "Fix item details", false],
		["inactive", "Not activated", false],
		["queued", "Queued", true],
		["working", "Publishing", true],
		["verifying", "Checking Crossref", true],
		["retrying", "Retrying automatically", true],
		["repair_pending", "Waiting for repair", false],
		["synced", "Synced", false],
		["failed", "Needs attention", false],
		["external", "Has a DOI", false],
	] as const)(
		"describes %s without browser-owned status rules",
		(state, label, shouldPoll) => {
			expect(
				describeAdminPublicationProviderState({
					provider: "crossref",
					state,
					waitingOn: null,
					firstBlocker: state === "blocked" ? "Add a title" : null,
					externalDoi: state === "external" ? "10.9999/external" : null,
				}),
			).toMatchObject({ label, shouldPoll });
		},
	);

	it("treats a DOI from another source as a settled fact, not a problem", () => {
		expect(
			describeAdminPublicationProviderState({
				provider: "crossref",
				state: "external",
				waitingOn: null,
				firstBlocker: null,
				externalDoi: "10.9999/external",
			}),
		).toEqual({
			label: "Has a DOI",
			description:
				"This record already has the DOI 10.9999/external from another source. Crossref registration is not needed.",
			shouldPoll: false,
		});
		expect(
			describeAdminPublicationProviderState({
				provider: "zenodo",
				state: "external",
				waitingOn: null,
				firstBlocker: null,
				externalDoi: "10.9999/external",
			}).description,
		).toBe(
			"This record already has the DOI 10.9999/external from another source. Zenodo publishing is not used for it.",
		);
	});

	it("explains how a missing job is repaired", () => {
		expect(
			describeAdminPublicationProviderState({
				provider: "zenodo",
				state: "repair_pending",
				waitingOn: null,
				firstBlocker: null,
			}),
		).toEqual({
			label: "Waiting for repair",
			description:
				"The nightly repair check will queue the missing Zenodo update.",
			shouldPoll: false,
		});
	});

	it.each([
		["crossref", "Waiting for Crossref", true],
		["file", "Waiting for a PDF", false],
	] as const)("describes Zenodo waiting on %s", (waitingOn, label, shouldPoll) => {
		expect(
			describeAdminPublicationProviderState({
				provider: "zenodo",
				state: "waiting",
				waitingOn,
				firstBlocker: null,
			}),
		).toMatchObject({ label, shouldPoll });
	});

	it.each([
		["disabled config", { configured: false }, "blocked"],
		["validation blocker", { blockers: ["Add a title"] }, "blocked"],
		[
			"external DOI",
			{ targetActive: false, externalDoi: "10.9999/external" },
			"external",
		],
		[
			"external DOI even when the provider is not configured",
			{ configured: false, targetActive: false, externalDoi: "10.9999/external" },
			"external",
		],
		[
			"external DOI after someone activated the provider anyway",
			{ targetActive: true, externalDoi: "10.9999/external" },
			"repair_pending",
		],
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
