import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PublicationRepositorySnapshot } from "@/lib/publication/repository";
import { DRIFTED_PAYLOAD_HASH, providerState } from "@/lib/publication/state-adapter";
import { zenodoPdfCorrectionIdentifier } from "@/lib/admin/native-file-service";

describe("Zenodo PDF correction state", () => {
	it("uses the DOI that each reuse policy actually archived", () => {
		expect(zenodoPdfCorrectionIdentifier("reuse-crossref", libraryConfigSchema.parse(maximalLibraryConfig).services.publication)).toEqual({
			environment: "test",
			ownership: "managed",
			registrar: "crossref",
			role: "primary",
		});
		expect(zenodoPdfCorrectionIdentifier("reuse-external", libraryConfigSchema.parse(maximalLibraryConfig).services.publication)).toEqual({
			environment: "sandbox",
			ownership: "external",
			registrar: "zenodo",
			role: "version",
		});
		expect(zenodoPdfCorrectionIdentifier("mint-zenodo", libraryConfigSchema.parse(maximalLibraryConfig).services.publication)).toBeNull();
	});

	it("keeps the archived files known after a metadata drift clears the payload hash", () => {
		const snapshot: PublicationRepositorySnapshot = {
			record: null,
			tags: [],
			attachments: [],
			files: [],
			targets: [],
			identifiers: [],
			states: [
				{
					itemKey: "PUBWRKAA",
					provider: "zenodo",
					environment: "sandbox",
					identifierPolicy: "reuse-crossref",
					lastPayloadHash: null,
					lastPayloadSnapshot: null,
					lastFileManifestHash: "a".repeat(64),
					lastFileManifestSnapshot: { files: [] },
					pendingStage: null,
					pendingPayloadHash: null,
					pendingPayloadSnapshot: null,
					pendingBatchId: null,
					pendingFilename: null,
					pendingSubmittedAt: null,
					pendingReason: null,
					zenodoRecordId: "7001",
					zenodoParentId: "7000",
					zenodoVersionDoi: "10.5555/library.000001",
					zenodoConceptDoi: null,
					orphanDraftDepositionId: null,
					lastFailureClass: null,
					lastFailureSummary: null,
					consecutiveFailures: 0,
					updatedAt: new Date("2030-08-21T02:00:00.000Z"),
					zenodoFirstPublishedAt: new Date("2030-08-20T12:00:00.000Z"),
					unpublishedDraftDepositionId: null,
				},
			],
			jobs: [],
			fileCorrectionApprovals: [],
			journals: [],
			namespace: null,
		};

		const state = providerState(snapshot, "zenodo", {
			crossref: { environment: "test" },
			zenodo: { environment: "sandbox" },
		} as Parameters<typeof providerState>[2]);

		expect(state?.zenodo?.lastSuccess).toEqual({
			payloadHash: DRIFTED_PAYLOAD_HASH,
			fileManifestHash: "a".repeat(64),
			fileManifestSnapshot: { files: [] },
		});
	});

	it("marks a superseded journal approval unavailable before remote publish", () => {
		const approvedAt = new Date("2030-08-20T12:00:00.000Z");
		const snapshot: PublicationRepositorySnapshot = {
			record: null,
			tags: [],
			attachments: [],
			files: [],
			targets: [
				{
					itemKey: "PUBWRKAA",
					provider: "zenodo",
					environment: "sandbox",
					identifierPolicy: "reuse-crossref",
					lockedExternalDoi: null,
					requestedBy: "admin",
					requestedAt: approvedAt,
					activatedAt: new Date("2026-08-01T00:00:00Z"),
      deactivatedAt: null,
					updatedAt: approvedAt,
				},
			],
			identifiers: [],
			states: [],
			jobs: [],
			fileCorrectionApprovals: [
				{
					id: 7,
					itemKey: "PUBWRKAA",
					provider: "zenodo",
					environment: "sandbox",
					doi: "10.5555/library.000001",
					fileManifestHash: "a".repeat(64),
					approvedAt,
					consumedAt: null,
					supersededAt: new Date("2030-08-20T12:01:00.000Z"),
					createdAt: approvedAt,
					updatedAt: new Date("2030-08-20T12:01:00.000Z"),
				},
			],
			journals: [
				{
					id: 9,
					itemKey: "PUBWRKAA",
					provider: "zenodo",
					environment: "sandbox",
					operationType: "zenodo_file_update",
					payloadHash: "b".repeat(64),
					payloadSnapshot: {},
					fileManifestHash: "a".repeat(64),
					fileManifestSnapshot: { files: [] },
					fileCorrectionApprovalId: 7,
					depositionId: "7001",
					draftRecordId: "7001",
					parentId: "7000",
					status: "ready_to_publish",
					publishedRecordId: null,
					identifiers: null,
					orphanDraftCleanupDepositionId: null,
					createdAt: approvedAt,
					updatedAt: approvedAt,
					publishedAt: null,
				},
			],
			namespace: null,
		};

		const state = providerState(snapshot, "zenodo", {
			crossref: { environment: "test" },
			zenodo: { environment: "sandbox" },
		} as Parameters<typeof providerState>[2]);

		expect(state?.zenodo?.consumedFileCorrectionApprovalIds).toEqual(["7"]);
		expect(state?.zenodo?.journal?.fileCorrectionApproval?.id).toBe("7");
	});
});
