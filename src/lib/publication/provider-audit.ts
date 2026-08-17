import { and, eq } from "drizzle-orm";

import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database } from "@/db/database-schema";
import {
	publicationSyncState,
	type PublicationEnvironment,
	type PublicationProvider,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";

import {
	assertPublicationJobLease,
	enqueuePublicationJobsForItem,
	finishPublicationJob,
} from "./queue";

export type PublicationAuditObservation =
	| { status: "matched" }
	| { status: "skipped"; reason: string }
	| {
			status: "drifted";
			metadataReasons: readonly string[];
			fileReasons: readonly string[];
	  };

export async function settlePublicationProviderAudit(
	database: Database,
	input: {
		jobId: number;
		workerId: string;
		itemKey: string;
		provider: PublicationProvider;
		environment: PublicationEnvironment;
		expectedPayloadHash: string;
		expectedFileManifestHash?: string;
		observation: PublicationAuditObservation;
		settledAt: Date;
	},
) {
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		await assertPublicationJobLease(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			observedAt: input.settledAt,
		});
		const [state] = await transaction
			.select({
				lastPayloadHash: publicationSyncState.lastPayloadHash,
				lastFileManifestHash:
					publicationSyncState.lastFileManifestHash,
			})
			.from(publicationSyncState)
			.where(
				and(
					eq(publicationSyncState.itemKey, input.itemKey),
					eq(publicationSyncState.provider, input.provider),
					eq(publicationSyncState.environment, input.environment),
				),
			)
			.limit(1)
			.for("update");
		const localStateChanged =
			!state ||
			state.lastPayloadHash !== input.expectedPayloadHash ||
			(input.expectedFileManifestHash !== undefined &&
				state.lastFileManifestHash !== input.expectedFileManifestHash);
		const observation = localStateChanged
			? {
					status: "skipped" as const,
					reason: "The saved provider state changed while the audit was running.",
				}
			: input.observation;

		if (observation.status === "drifted") {
			const metadataDrifted = observation.metadataReasons.length > 0;
			const filesDrifted = observation.fileReasons.length > 0;
			await transaction
				.update(publicationSyncState)
				.set({
					...(metadataDrifted
						? {
								lastPayloadHash: null,
								lastPayloadSnapshot: null,
							}
						: {}),
					...(filesDrifted
						? {
								lastFileManifestHash: null,
								lastFileManifestSnapshot: null,
							}
						: {}),
					updatedAt: input.settledAt,
				})
				.where(
					and(
						eq(publicationSyncState.itemKey, input.itemKey),
						eq(publicationSyncState.provider, input.provider),
						eq(
							publicationSyncState.environment,
							input.environment,
						),
					),
				);
			const [current] = await transaction
				.select({ revision: item.revision })
				.from(item)
				.where(eq(item.key, input.itemKey))
				.limit(1);
			if (!current) throw new Error("The audited publication record no longer exists");
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: input.itemKey,
				canonicalRevision: current.revision,
				reason: "nightly_reconciliation",
				now: input.settledAt,
				providers: [input.provider],
				idempotencyDiscriminator: `audit:${input.jobId}`,
			});
		}

		await finishPublicationJob(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			finishedAt: input.settledAt,
			receipt: {
				provider: input.provider,
				environment: input.environment,
				audit: observation,
			},
		});
		return observation;
	});
}
