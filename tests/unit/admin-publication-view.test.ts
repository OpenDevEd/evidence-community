import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { buildAdminPublicationViewFromSnapshot } from "@/lib/publication/admin-publication-view";
import { PublicationItemNotFoundError } from "@/lib/publication/errors";
import type { PublicationRecordExtras } from "@/lib/publication/record-extras";
import type { PublicationRepositorySnapshot } from "@/lib/publication/repository";

type Snapshot = PublicationRepositorySnapshot;

const config = {
	identity: { baseUrl: "https://library.example.org" },
	services: {
		publication: {
			crossref: {
				enabled: true,
				environment: "test",
				loginId: "test-login",
				depositorName: "Evidence Library",
				email: "doi@example.org",
				password: "password",
				registrant: "Evidence Library",
				prefix: "10.5555",
				suffixNamespace: "library.",
			},
			zenodo: {
				enabled: true,
				environment: "sandbox",
				token: "token",
				defaultIdentifierPolicy: "reuse-crossref",
				accessRight: "open",
				license: "cc-by-4.0",
			},
			worker: {
				batchSize: 25,
				leaseSeconds: 900,
				retryLimit: 8,
				nightlyUtcTime: "02:00",
			},
		},
	},
} as Pick<LibraryServerConfig, "identity" | "services">;

function record(changes: Record<string, unknown> = {}) {
	return {
		key: "ABCDEFGH",
		revision: 4,
		itemType: "JournalArticle",
		title: "A useful study",
		date: "2024-03-04",
		abstractNote: "A complete description",
		languageName: "eng",
		publisher: "Publisher",
		rights: "Copyright holder",
		licence: { kind: "zenodo", id: "cc-by-4.0" },
		creators: [
			{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
		],
		publicationTitle: "Research Journal",
		createdAt: new Date("2024-01-01T00:00:00Z"),
		dateAdded: new Date("2024-01-02T00:00:00Z"),
		updatedAt: new Date("2026-08-12T00:00:00Z"),
		deleted: 0,
		parentItem: null,
		DOI: null,
		extra: null,
		...changes,
	} as NonNullable<Snapshot["record"]>;
}

function snapshot(changes: Partial<Snapshot> = {}): Snapshot {
	return {
		record: record(),
		tags: ["education"],
		attachments: [],
		files: [],
		targets: [],
		identifiers: [],
		states: [],
		jobs: [],
		fileCorrectionApprovals: [],
		journals: [],
		namespace: null,
		...changes,
	};
}

function target(
	provider: "crossref" | "zenodo",
	identifierPolicy:
		"reuse-crossref" | "reuse-external" | "mint-zenodo" | null = null,
) {
	return {
		itemKey: "ABCDEFGH",
		provider,
		environment: provider === "crossref" ? "test" : "sandbox",
		identifierPolicy,
		requestedBy: "admin",
		requestedAt: new Date("2026-08-12T10:00:00Z"),
		deactivatedAt: null,
		updatedAt: new Date("2026-08-12T10:00:00Z"),
	} as Snapshot["targets"][number];
}

function identifier(input: {
	provider: "crossref" | "zenodo";
	doi: string;
	role?: "primary" | "version" | "concept";
	lifecycle?: "reserved" | "verified";
	ownership?: "managed" | "external";
}) {
	return {
		id: 1,
		itemKey: "ABCDEFGH",
		registrar: input.provider,
		environment: input.provider === "crossref" ? "test" : "sandbox",
		role: input.role ?? "primary",
		doi: input.doi,
		ownership: input.ownership ?? "managed",
		lifecycle: input.lifecycle ?? "verified",
		isCurrent: true,
		reservedAt: new Date("2026-08-12T10:00:00Z"),
		verifiedAt:
			input.lifecycle === "reserved"
				? null
				: new Date("2026-08-12T10:05:00Z"),
		createdAt: new Date("2026-08-12T10:00:00Z"),
		updatedAt: new Date("2026-08-12T10:05:00Z"),
	} as Snapshot["identifiers"][number];
}

function job(changes: Record<string, unknown> = {}) {
	return {
		id: 1,
		itemKey: "ABCDEFGH",
		provider: "crossref",
		environment: "test",
		canonicalRevision: 4,
		fileRevision: null,
		reason: "manual_activation",
		idempotencyKey: "crossref:ABCDEFGH:4",
		attempts: 0,
		lastError: null,
		nextAttemptAt: new Date("2026-08-12T10:00:00Z"),
		leaseOwner: null,
		leaseExpiresAt: null,
		createdAt: new Date("2026-08-12T10:00:00Z"),
		updatedAt: new Date("2026-08-12T10:00:00Z"),
		processedAt: null,
		deadLetteredAt: null,
		supersededAt: null,
		resultReceipt: null,
		...changes,
	} as Snapshot["jobs"][number];
}

function syncState(changes: Record<string, unknown> = {}) {
	return {
		itemKey: "ABCDEFGH",
		provider: "zenodo",
		environment: "sandbox",
		identifierPolicy: "mint-zenodo",
		lastPayloadHash: null,
		lastPayloadSnapshot: null,
		lastFileManifestHash: null,
		lastFileManifestSnapshot: null,
		pendingStage: null,
		pendingPayloadHash: null,
		pendingPayloadSnapshot: null,
		pendingBatchId: null,
		pendingFilename: null,
		pendingSubmittedAt: null,
		pendingReason: null,
		zenodoRecordId: "456",
		zenodoParentId: "123",
		zenodoVersionDoi: "10.5072/zenodo.456",
		zenodoConceptDoi: "10.5072/zenodo.123",
		orphanDraftDepositionId: null,
		lastFailureClass: null,
		lastFailureSummary: null,
		consecutiveFailures: 0,
		updatedAt: new Date("2026-08-12T10:00:00Z"),
		...changes,
	} as Snapshot["states"][number];
}

// A record that cites nothing and names no topics, countries or institutions.
const extras: PublicationRecordExtras = { links: [], topicNames: [], countries: [], institutions: {}, formats: [] };

describe("admin publication view", () => {
	it("shows details it couldn't read as what blocks the record, instead of failing the page", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras: new Error("OpenAlex answered 503"),
			itemKey: "ABCDEFGH",
			snapshot: snapshot(),
			config,
		});

		expect(view.providers.crossref.blockers).toContain("OpenAlex answered 503");
		expect(view.providers.zenodo.blockers).toContain("OpenAlex answered 503");
	});

	it("shows the namespace before activation without guessing the next DOI", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot(),
			config,
		});

		expect(view.doiNamespace).toEqual({
			prefix: "10.5555",
			suffixNamespace: "library.",
		});
		expect(view.providers.crossref).toMatchObject({
			displayState: "inactive",
			status: {
				label: "Not activated",
				description:
					"Reserve and register a Crossref DOI for this record.",
				shouldPoll: false,
			},
			blockers: [],
			capabilities: { canActivate: true },
			exact: { plan: { status: "skipped" } },
		});
		expect(
			view.providers.zenodo.capabilities.allowedIdentifierPolicies,
		).toEqual(["mint-zenodo"]);
		expect(JSON.stringify(view)).not.toContain("000000");
	});

	it("does not expose the saved next namespace sequence", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				namespace: {
					environment: "test",
					prefix: "10.5555",
					suffixNamespace: "library.",
					nextSequence: 42,
					createdAt: new Date("2026-08-12T10:00:00Z"),
					updatedAt: new Date("2026-08-12T10:00:00Z"),
				},
			}),
			config,
		});

		expect(view.doiNamespace).toEqual({
			prefix: "10.5555",
			suffixNamespace: "library.",
		});
		expect(JSON.stringify(view)).not.toContain("000042");
	});

	it("shows a record with a DOI from another source as settled, not blocked", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ record: record({ DOI: "10.9999/external" }) }),
			config,
		});

		expect(view.providers.crossref.displayState).toBe("external");
		expect(view.providers.zenodo.displayState).toBe("external");
		expect(view.providers.crossref.externalDoi).toBe("10.9999/external");
		expect(view.providers.crossref.status.label).toBe("Has a DOI");
		expect(view.providers.crossref.blockers).toEqual([]);
		expect(view.providers.zenodo.blockers).toEqual([]);
		expect(view.providers.crossref.capabilities.canActivate).toBe(false);
		expect(view.providers.zenodo.capabilities.canActivate).toBe(false);
		expect(
			view.providers.zenodo.capabilities.allowedIdentifierPolicies,
		).toEqual(["reuse-external"]);
	});

	it("treats a metadata-only DOI on this library's prefix as external too", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ record: record({ DOI: "10.5555/existing" }) }),
			config,
		});

		expect(view.providers.crossref.displayState).toBe("external");
		expect(view.providers.zenodo.displayState).toBe("external");
		expect(view.providers.crossref.externalDoi).toBe("10.5555/existing");
	});

	it("does not treat an external identifier on the configured prefix as managed", () => {
		const external = identifier({
			provider: "crossref",
			doi: "10.5555/existing",
			ownership: "external",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: external.doi }),
				targets: [target("crossref")],
				identifiers: [external],
			}),
			config,
		});

		expect(view.providers.crossref.displayState).toBe("blocked");
		expect(view.providers.crossref.blockers).toContain(
			"Activate and verify the Crossref DOI required by this publication",
		);
		expect(view.providers.crossref.links).toEqual([]);
		expect(JSON.stringify(view.providers.crossref.blockers)).not.toContain(
			"MISSING_MANAGED_CROSSREF_DOI",
		);
	});

	it("blocks an unclassified external Zenodo DOI from all new DOI allocation", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: "10.5281/zenodo.123" }),
			}),
			config,
		});

		expect(view.bibliographicDoi).toMatchObject({
			status: "resolved",
			doi: "10.5281/zenodo.123",
		});
		expect(view.providers.crossref.capabilities.canActivate).toBe(false);
		expect(view.providers.zenodo.capabilities.canActivate).toBe(false);
	});

	it("ignores this record's own managed Zenodo DOI when considering Crossref", () => {
		const managedZenodo = identifier({
			provider: "zenodo",
			doi: "10.5072/zenodo.456",
			role: "version",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managedZenodo.doi }),
				targets: [target("zenodo", "mint-zenodo")],
				identifiers: [managedZenodo],
			}),
			config,
		});

		expect(view.bibliographicDoi.status).toBe("none");
		expect(view.providers.crossref.capabilities.canActivate).toBe(true);
	});

	it("shows a queued reserved Crossref DOI immediately", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [target("crossref")],
				identifiers: [managed],
				jobs: [job()],
			}),
			config,
			now: new Date("2026-08-12T10:00:00Z"),
		});

		expect(view.providers.crossref.displayState).toBe("queued");
		expect(view.providers.crossref.status).toEqual({
			label: "Queued",
			description:
				"Crossref publishing will start when the worker is ready.",
			shouldPoll: true,
		});
		expect(view.providers.crossref.exact.plan).toMatchObject({
			status: "write_required",
			operations: ["crossref_redeposit"],
		});
		expect(view.providers.crossref.links).toEqual([
			expect.objectContaining({
				label: "Reserved Crossref DOI",
				status: "reserved",
				value: managed.doi,
			}),
		]);
	});

	it("redeposits edited metadata without changing the managed Crossref DOI", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({
					DOI: managed.doi,
					revision: 5,
					title: "Edited study title",
				}),
				targets: [target("crossref")],
				identifiers: [managed],
				states: [
					syncState({
						provider: "crossref",
						environment: "test",
						identifierPolicy: null,
						lastPayloadHash: "a".repeat(64),
						lastPayloadSnapshot: { title: "Original study title" },
						zenodoRecordId: null,
						zenodoParentId: null,
						zenodoVersionDoi: null,
						zenodoConceptDoi: null,
					}),
				],
				jobs: [
					job({
						canonicalRevision: 5,
						reason: "record_changed",
					}),
				],
			}),
			config,
		});

		expect(view.bibliographicDoi).toMatchObject({
			status: "resolved",
			doi: managed.doi,
		});
		expect(view.providers.crossref).toMatchObject({
			displayState: "queued",
			exact: {
				identifiers: [
					expect.objectContaining({
						doi: managed.doi,
						lifecycle: "verified",
					}),
				],
				plan: {
					status: "write_required",
					operations: ["crossref_redeposit"],
				},
			},
		});
		expect(view.providers.crossref.links).toEqual([
			expect.objectContaining({ value: managed.doi }),
		]);
	});

	it("waits for Crossref verification before reusing its DOI in Zenodo", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [
					target("crossref"),
					target("zenodo", "reuse-crossref"),
				],
				identifiers: [managed],
			}),
			config,
		});

		expect(view.providers.zenodo).toMatchObject({
			displayState: "waiting",
			waitingOn: "crossref",
			status: {
				label: "Waiting for Crossref",
				description:
					"Zenodo will publish after Crossref verifies the reserved DOI.",
				shouldPoll: true,
			},
		});
	});

	it("exposes saved Crossref submission evidence while verification is pending", () => {
		const submittedAt = new Date("2026-08-17T12:00:00.000Z");
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				targets: [target("crossref")],
				states: [
					syncState({
						provider: "crossref",
						environment: "test",
						identifierPolicy: null,
						pendingStage: "deposit",
						pendingPayloadHash: "a".repeat(64),
						pendingBatchId: "batch-17",
						pendingFilename: "docs-pen-17.xml",
						pendingSubmittedAt: submittedAt,
						pendingReason: "record_changed",
					}),
				],
			}),
			config,
		});

		expect(view.providers.crossref.exact.pendingSubmission).toEqual({
			batchId: "batch-17",
			filename: "docs-pen-17.xml",
			submittedAt: submittedAt.toISOString(),
			reason: "record_changed",
		});
		expect(view.providers.zenodo.exact.pendingSubmission).toBeNull();
	});

	it("prepares the first archive draft without requiring archive metadata", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			config,
			snapshot: snapshot({
				record: record({ abstractNote: null, creators: [] }),
				targets: [target("zenodo", "mint-zenodo")],
			}),
		});
		expect(view.providers.zenodo).toMatchObject({
			displayState: "waiting",
			waitingOn: "file",
			blockers: [],
			exact: { plan: { status: "waiting_for_file" } },
		});
	});

	it("waits locally for a published file before minting a Zenodo DOI", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ targets: [target("zenodo", "mint-zenodo")] }),
			config,
		});

		expect(view.providers.zenodo).toMatchObject({
			displayState: "waiting",
			waitingOn: "file",
			status: {
				label: "Waiting for a PDF",
				description:
					"Publish a PDF attachment to continue with Zenodo.",
				shouldPoll: false,
			},
			exact: { plan: { status: "waiting_for_file" } },
		});
	});

	it("blocks unsupported Crossref item types with the provider message", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ record: record({ itemType: "Artwork" }) }),
			config,
		});

		expect(view.providers.crossref.displayState).toBe("blocked");
		expect(view.providers.crossref.blockers).toContainEqual(
			expect.stringMatching(/^Crossref can't register a DOI for this item type/u),
		);
	});

	it("uses the newest non-superseded job as the visible progress", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [target("crossref")],
				identifiers: [managed],
				jobs: [
					job({ id: 2, createdAt: new Date("2026-08-12T11:00:00Z") }),
					job({
						id: 1,
						attempts: 8,
						deadLetteredAt: new Date("2026-08-12T10:30:00Z"),
					}),
				],
			}),
			config,
		});

		expect(view.providers.crossref.displayState).toBe("queued");
		expect(view.providers.crossref.exact.job?.id).toBe(2);
	});

	it("keeps superseded jobs in history without making them current", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [target("crossref")],
				identifiers: [managed],
				jobs: [
					job({
						id: 3,
						createdAt: new Date("2026-08-12T12:00:00Z"),
						supersededAt: new Date("2026-08-12T12:01:00Z"),
					}),
					job({ id: 2, createdAt: new Date("2026-08-12T11:00:00Z") }),
				],
			}),
			config,
		});

		expect(view.providers.crossref.exact.job?.id).toBe(2);
		expect(view.providers.crossref.exact.recentJobs).toEqual([
			expect.objectContaining({
				id: 3,
				supersededAt: expect.any(String),
			}),
			expect.objectContaining({ id: 2, supersededAt: null }),
		]);
	});

	it("keeps a journaled Zenodo publish visible even before state settlement", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				targets: [target("zenodo", "mint-zenodo")],
				journals: [
					{
						id: 1,
						itemKey: "ABCDEFGH",
						provider: "zenodo",
						environment: "sandbox",
						operationType: "zenodo_create",
						payloadHash: "a".repeat(64),
						payloadSnapshot: {},
						fileManifestHash: "b".repeat(64),
						fileManifestSnapshot: { files: [] },
						depositionId: "123",
						draftRecordId: "456",
						parentId: null,
						fileCorrectionApprovalId: null,
						status: "ready_to_publish",
						publishedRecordId: null,
						identifiers: null,
						orphanDraftCleanupDepositionId: null,
						createdAt: new Date("2026-08-12T10:00:00Z"),
						updatedAt: new Date("2026-08-12T10:00:00Z"),
						publishedAt: null,
					},
				],
			}),
			config,
		});

		expect(view.providers.zenodo.displayState).toBe("verifying");
		expect(view.providers.zenodo.exact.plan.operations).toEqual([
			"zenodo_publish_journaled_draft",
		]);
	});

	it("uses settled Zenodo state when planning the Crossref archive relation", () => {
		const crossref = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
		});
		const zenodoVersion = identifier({
			provider: "zenodo",
			doi: "10.5072/zenodo.456",
			role: "version",
		});
		const zenodoConcept = identifier({
			provider: "zenodo",
			doi: "10.5072/zenodo.123",
			role: "concept",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: crossref.doi }),
				targets: [target("crossref"), target("zenodo", "mint-zenodo")],
				identifiers: [crossref, zenodoVersion, zenodoConcept],
				states: [syncState()],
			}),
			config,
		});

		expect(view.providers.crossref.blockers).toEqual([]);
		expect(view.providers.crossref.exact.plan.operations).toContain(
			"crossref_redeposit",
		);
	});

	it("keeps Zenodo metadata errors out of the Crossref blockers", () => {
		const crossref = identifier({
			provider: "crossref",
			doi: "10.5555/library.000001",
		});
		const zenodoVersion = identifier({
			provider: "zenodo",
			doi: "10.5072/zenodo.456",
			role: "version",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: crossref.doi, title: "AI" }),
				targets: [target("crossref"), target("zenodo", "mint-zenodo")],
				identifiers: [crossref, zenodoVersion],
				states: [syncState()],
			}),
			config,
		});

		expect(view.providers.zenodo.blockers).toContainEqual(
			expect.stringMatching(/^Zenodo /u),
		);
		expect(
			view.providers.crossref.blockers.some((blocker) =>
				blocker.startsWith("Zenodo "),
			),
		).toBe(false);
		expect(view.providers.crossref).toMatchObject({
			displayState: "repair_pending",
			exact: {
				plan: {
					status: "unavailable",
					reason: "ZENODO_RELATION_NOT_READY",
				},
			},
		});
	});

	it("reports every provider issue even when the title is missing", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({
					abstractNote: null,
					creators: [],
					itemType: "Report",
					publisher: null,
					title: "",
				}),
			}),
			config,
		});

		// Each provider's own checks name that provider, so an editor knows which DOI needs the field.
		expect(view.providers.crossref.blockers).toEqual(
			expect.arrayContaining([
				"Add a title before activating publication",
				expect.stringMatching(/^Crossref /u),
			]),
		);
		expect(
			view.providers.zenodo.blockers.filter((blocker) =>
				blocker.startsWith("Zenodo "),
			),
		).toHaveLength(2);
	});

	it("blocks a changed namespace after the first reservation", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				namespace: {
					environment: "test",
					prefix: "10.5555",
					suffixNamespace: "old.",
					nextSequence: 2,
					createdAt: new Date("2026-08-12T10:00:00Z"),
					updatedAt: new Date("2026-08-12T10:00:00Z"),
				},
			}),
			config,
		});

		expect(view.providers.crossref.blockers).toContain(
			"The configured DOI prefix or namespace does not match the namespace already used by this community",
		);
	});

	it("attributes corrupt Zenodo state only to Zenodo", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				targets: [target("zenodo", "mint-zenodo")],
				states: [syncState({ identifierPolicy: "invalid" })],
			}),
			config,
		});

		expect(view.providers.zenodo.blockers).toContain(
			"Saved Zenodo publication state is invalid",
		);
		expect(view.providers.crossref.blockers).not.toContain(
			"Saved Crossref publication state is invalid",
		);
	});

	it("turns invalid published file bundles into a Zenodo blocker", () => {
		const file = {
			itemKey: "FILE0001",
			revision: 1,
			filename: "paper.pdf",
			contentType: "application/pdf",
			sizeBytes: 123,
			sha256: "a".repeat(64),
		} as Snapshot["files"][number];
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				files: [file, { ...file, itemKey: "FILE0002" }],
			}),
			config,
		});

		expect(view.providers.zenodo.blockers).toContain(
			"Published files must use different filenames",
		);
		expect(view.providers.crossref.blockers).not.toContain(
			"Published files must use different filenames",
		);
	});

	it("fails clearly when the item does not exist", () => {
		expect(() =>
			buildAdminPublicationViewFromSnapshot({
				extras,
				itemKey: "MISSING1",
				snapshot: snapshot({ record: null }),
				config,
			}),
		).toThrow(PublicationItemNotFoundError);
	});
});

describe("identifiers view", () => {
	it("treats a record with no DOI as optional work, not a problem", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ record: record({ abstractNote: undefined }) }),
			config,
		});
		const { identifiers } = view;
		expect(identifiers.doi).toBeNull();
		expect(identifiers.registration).toEqual({ state: "none" });
		expect(identifiers.archive).toEqual({ state: "none" });
		expect(identifiers.attention).toBe(false);
		expect(identifiers.actions.map((action) => action.id)).toEqual([
			"register-crossref",
			"mint-zenodo",
		]);
		const zenodo = identifiers.actions.find((a) => a.id === "mint-zenodo")!;
		expect(zenodo.available).toBe(true);
		expect(zenodo.ready).toBe(true);
		expect(zenodo.readiness.every((check) => check.ok)).toBe(true);
	});

	it("reports a ready action with one positive line instead of an empty list", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot(),
			config,
		});
		const crossref = view.identifiers.actions.find(
			(a) => a.id === "register-crossref",
		)!;
		expect(crossref.ready).toBe(true);
		expect(crossref.readiness).toEqual([
			{ label: "Record details", ok: true, field: null },
		]);
	});

	it("shows a DOI the record brought with it as a fact and drops Crossref", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({ record: record({ DOI: "10.9999/external" }) }),
			config,
		});
		const { identifiers } = view;
		expect(identifiers.doi).toEqual({
			value: "10.9999/external",
			origin: "record",
			url: "https://doi.org/10.9999/external",
		});
		expect(identifiers.actions.map((a) => a.id)).toEqual([
			"archive-zenodo",
		]);
		const archive = identifiers.actions[0]!;
		expect(archive.available).toBe(true);
		expect(
			view.providers.zenodo.capabilities.allowedIdentifierPolicies,
		).toEqual(["reuse-external"]);
		expect(identifiers.attention).toBe(false);
	});

	it("does not claim field-level provenance for a source-linked record", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({
					DOI: "10.9999/external",
					sourceConnectionKey: "zotero-playground",
				}),
			}),
			config,
		});
		expect(view.identifiers.doi?.origin).toBe("record");
	});

	it("shows a managed Crossref DOI as registration in progress", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000042",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [target("crossref")],
				identifiers: [managed],
			}),
			config,
		});
		const { identifiers } = view;
		expect(identifiers.doi).toMatchObject({
			value: managed.doi,
			origin: "crossref",
		});
		expect(identifiers.registration).toMatchObject({
			state: "active",
			provider: "crossref",
		});
		expect(identifiers.actions.map((a) => a.id)).toEqual([
			"archive-zenodo",
		]);
	});

	it("asks for attention only when something activated has failed", () => {
		const managed = identifier({
			provider: "crossref",
			doi: "10.5555/library.000042",
			lifecycle: "reserved",
		});
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				record: record({ DOI: managed.doi }),
				targets: [target("crossref")],
				identifiers: [managed],
				jobs: [
					job({
						id: 1,
						attempts: 8,
						deadLetteredAt: new Date("2026-08-12T10:30:00Z"),
					}),
				],
			}),
			config,
		});
		expect(view.providers.crossref.displayState).toBe("failed");
		expect(view.providers.crossref.capabilities.canRetry).toBe(true);
		expect(view.identifiers.attention).toBe(true);
	});

	it("does not offer manual retry while the worker owns automatic retries", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				targets: [target("zenodo", "mint-zenodo")],
				states: [
					syncState({
						lastFailureClass: "transient",
						lastFailureSummary: "Provider unavailable",
						consecutiveFailures: 1,
					}),
				],
				jobs: [
					job({
						provider: "zenodo",
						environment: "sandbox",
						attempts: 1,
						lastError: "Provider unavailable",
					}),
				],
			}),
			config,
		});
		expect(view.providers.zenodo.displayState).toBe("failed");
		expect(view.providers.zenodo.capabilities.canRetry).toBe(false);
	});

	it("does not offer manual retry when the plan needs attention", () => {
		const archived = archivedUnderOwnDoi("10.9999/external");
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: snapshot({
				...archived,
				files: [
					{
						itemKey: "FILE0001",
						revision: 1,
						filename: "paper.pdf",
						contentType: "application/pdf",
						sizeBytes: 123,
						sha256: "a".repeat(64),
					} as Snapshot["files"][number],
				],
				states: archived.states.map((state) => ({
					...state,
					lastPayloadHash: "b".repeat(64),
					lastPayloadSnapshot: {},
					// The archived PDF no longer matches the published files and no correction was approved.
					lastFileManifestHash: "c".repeat(64),
					lastFailureClass: "ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED",
					lastFailureSummary:
						"Record is unsafe to sync: ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED",
					consecutiveFailures: 2,
				})),
				jobs: [
					job({
						provider: "zenodo",
						environment: "sandbox",
						attempts: 2,
						lastError:
							"Record is unsafe to sync: ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED",
						deadLetteredAt: new Date("2026-08-22T10:30:00Z"),
					}),
				],
			}),
			config,
		});
		expect(view.providers.zenodo.exact.plan.status).toBe("needs_attention");
		expect(view.providers.zenodo.displayState).toBe("failed");
		expect(view.providers.zenodo.capabilities.canRetry).toBe(false);
		expect(view.providers.zenodo.blockers[0]).toMatch(/PDF/);
	});

	function archivedUnderOwnDoi(recordDoi: string) {
		return snapshot({
			record: record({ DOI: recordDoi }),
			targets: [target("zenodo", "reuse-external")],
			// Settlement stores the reused DOI as external, never managed.
			identifiers: [
				identifier({
					provider: "zenodo",
					doi: "10.9999/external",
					role: "version",
					ownership: "external",
				}),
			],
			states: [
				syncState({
					provider: "zenodo",
					environment: "sandbox",
					identifierPolicy: "reuse-external",
					zenodoRecordId: "588743",
					zenodoParentId: "588742",
					zenodoVersionDoi: "10.9999/external",
					zenodoFirstPublishedAt: new Date("2026-08-21T10:00:00Z"),
				}),
			],
		});
	}

	it("keeps the record's own DOI as the record's after Zenodo archived under it", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: archivedUnderOwnDoi("10.9999/external"),
			config,
		});
		expect(view.identifiers.doi).toMatchObject({
			value: "10.9999/external",
			origin: "record",
		});
		expect(view.providers.zenodo.blockers).toEqual([]);
	});

	it("blocks Zenodo when the record DOI was changed after archiving under it", () => {
		const view = buildAdminPublicationViewFromSnapshot({
			extras,
			itemKey: "ABCDEFGH",
			snapshot: archivedUnderOwnDoi("10.9999/changed"),
			config,
		});
		expect(view.providers.zenodo.blockers).toContainEqual(
			expect.stringContaining(
				"no longer matches the DOI archived on Zenodo",
			),
		);
	});
});
