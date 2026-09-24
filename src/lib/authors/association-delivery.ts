import type { Database } from "@/db/database-schema";
import { runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getPublicItemCard } from "@/lib/public-item-card";

export async function runAuthorAssociationCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal) {
  return runAssociationDeliveryCycle(database, "authorAssociationDelivery", job => deliverAssociations(database, config, job, signal));
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
