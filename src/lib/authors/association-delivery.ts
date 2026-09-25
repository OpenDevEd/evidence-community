import type { Database } from "@/db/database-schema";
import { postOpenScholarAssociation, runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
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

	await postOpenScholarAssociation(
		config,
		"/api/v1/evidence-libraries/author-associations",
		"association update",
		{
			libraryId: config.authentication.openScholar.libraryId,
			itemKey: job.itemKey,
			revision: publicationRevision(job.revision, card),
			profileIds: profileIdsFor(card),
		},
		signal,
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
