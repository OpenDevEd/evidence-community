import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { authorAssociationDelivery } from "@/db/schema/author-associations";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getPublicItemCard } from "@/lib/public-item-card";

export async function runAuthorAssociationCycle(
	database: Database,
	config: LibraryServerConfig,
	signal?: AbortSignal,
) {
	const token = randomUUID();
	const claimed = await database.execute<{
		itemKey: string;
		revision: number;
		attempts: number;
	}>(sql`
		UPDATE "authorAssociationDelivery" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '60 seconds'
		WHERE "itemKey" = (
			SELECT "itemKey" FROM "authorAssociationDelivery"
			WHERE "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
			ORDER BY "nextAttemptAt", "itemKey" FOR UPDATE SKIP LOCKED LIMIT 1
		) RETURNING "itemKey", "revision", "attempts"
	`);
	const job = claimed.rows[0];
	if (!job) return false;
	const owned = and(
		eq(authorAssociationDelivery.itemKey, job.itemKey),
		eq(authorAssociationDelivery.leaseToken, token),
	);
	try {
		await deliverAssociations(database, config, job, signal);
		await database
			.update(authorAssociationDelivery)
			.set({
				nextAttemptAt: null,
				leaseToken: null,
				leaseExpiresAt: null,
				lastError: null,
			})
			.where(owned);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Author association delivery failed", {
			itemKey: job.itemKey,
			revision: job.revision,
			error: message,
		});
		const attempts = job.attempts + 1;
		await database
			.update(authorAssociationDelivery)
			.set({
				attempts,
				nextAttemptAt: new Date(
					Date.now() +
						Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
				),
				leaseToken: null,
				leaseExpiresAt: null,
				lastError: message.slice(0, 2000),
			})
			.where(owned);
	}
	return true;
}

async function deliverAssociations(
	database: Database,
	config: LibraryServerConfig,
	job: { itemKey: string; revision: number },
	signal?: AbortSignal,
) {
	const card = await getPublicItemCard(
		database,
		job.itemKey,
		config,
	);

	const service = config.authentication.openScholar;
	const response = await fetch(
		new URL(
			"/api/v1/evidence-libraries/author-associations",
			service.convexSiteUrl,
		),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${service.machineCredential}`,
			},
			body: JSON.stringify({
				libraryId: service.libraryId,
				itemKey: job.itemKey,
				revision: publicationRevision(job.revision, card),
				profileIds: profileIdsFor(card),
			}),
			signal: AbortSignal.any([
				AbortSignal.timeout(10000),
				...(signal ? [signal] : []),
			]),
		},
	);
	if (!response.ok)
		throw new Error(
			`OpenScholar association update returned ${response.status}: ${(await response.text()).slice(0, 500)}`,
		);
}

function profileIdsFor(card: Awaited<ReturnType<typeof getPublicItemCard>>) {
	return [
		...new Set(
			(card?.creators ?? []).flatMap((creator) =>
				creator.authorProfileId ? [creator.authorProfileId] : [],
			),
		),
	];
}

function publicationRevision(
	revision: number,
	card: Awaited<ReturnType<typeof getPublicItemCard>>,
) {
	return Math.max(Number(revision), card?.revision ?? 0);
}
