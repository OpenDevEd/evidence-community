import type { AdminCreator } from "./types";

function creatorIdentity(creator: AdminCreator) {
	return JSON.stringify([
		creator.creatorType, creator.name ?? null,
		creator.firstName ?? null, creator.lastName ?? null,
	]);
}

/**
 * True when a source would see the same creators. Profile links,
 * affiliations and an organisation's mark belong to the library, so a change
 * to those alone is not a reason to write the record back.
 */
export function sameBibliographicCreators(left: unknown, right: unknown) {
	if (!Array.isArray(left) || !Array.isArray(right)) return false;
	return (
		left.length === right.length &&
		left.every(
			(creator, index) =>
				creatorIdentity(creator as AdminCreator) ===
				creatorIdentity(right[index] as AdminCreator),
		)
	);
}

/** Profile links and an organisation's mark are library-owned. Providers that supply affiliations can refresh them. */
export function preserveCreatorProfileLinks<T extends AdminCreator>(
	incoming: T[] | null | undefined,
	previous: readonly AdminCreator[] | null | undefined,
	options: { sourceAffiliations?: boolean } = {},
): T[] | null | undefined {
	if (!incoming) return incoming;
	const unchangedOrder = previous?.length === incoming.length && incoming.every(
		(creator, index) => creatorIdentity(creator) === creatorIdentity(previous[index]!),
	);
	const previousByIdentity = new Map<string, AdminCreator[]>();
	for (const creator of previous ?? []) {
		const identity = creatorIdentity(creator);
		previousByIdentity.set(identity, [...(previousByIdentity.get(identity) ?? []), creator]);
	}
	const incomingCounts = new Map<string, number>();
	for (const creator of incoming) {
		const identity = creatorIdentity(creator);
		incomingCounts.set(identity, (incomingCounts.get(identity) ?? 0) + 1);
	}
	return incoming.map((creator, index) => {
		const next = {...creator};
		delete next.authorProfileId;
		delete next.organization;
		if (!options.sourceAffiliations) delete next.institutions;
		const identity = creatorIdentity(creator);
		const matches = unchangedOrder ? [previous![index]!] : previousByIdentity.get(identity);
		if (matches?.length === 1 && (unchangedOrder || incomingCounts.get(identity) === 1)) keepLibraryFields(next, matches[0]!, options.sourceAffiliations);
		return next;
	});
}

function keepLibraryFields(next: AdminCreator, match: AdminCreator, sourceAffiliations?: boolean) {
	if (match.authorProfileId) next.authorProfileId = match.authorProfileId;
	if (match.organization) next.organization = true;
	if (!sourceAffiliations && match.institutions?.length) next.institutions = match.institutions;
}
