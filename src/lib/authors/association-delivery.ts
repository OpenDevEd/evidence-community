import type { Database } from "@/db/database-schema";
import { drainAssociationQueue, eachAssociation, postOpenScholarAssociation, runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getPublicItemCard } from "@/lib/public-item-card";

/** Records sent at once, each in its own call. */
const AT_ONCE = 10;

export async function runAuthorAssociationCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal) {
  return drainAssociationQueue(() => runAssociationDeliveryCycle(database, "authorAssociationDelivery",
    eachAssociation(job => deliverAssociations(database, config, job, signal)), AT_ONCE), signal);
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
