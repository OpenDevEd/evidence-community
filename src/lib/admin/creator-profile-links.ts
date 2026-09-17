import type { AdminCreator } from "./types";

function creatorIdentity(creator: AdminCreator) {
	return JSON.stringify([
		creator.creatorType, creator.name ?? null,
		creator.firstName ?? null, creator.lastName ?? null,
	]);
}

/** Source providers cannot assign profiles or affiliations; carry existing ones only across unambiguous authors. */
export function preserveCreatorProfileLinks<T extends AdminCreator>(
	incoming: T[] | null | undefined,
	previous: readonly AdminCreator[] | null | undefined,
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
		delete next.institutions;
		const identity = creatorIdentity(creator);
		const matches = unchangedOrder ? [previous![index]!] : previousByIdentity.get(identity);
		if (matches?.length === 1 && (unchangedOrder || incomingCounts.get(identity) === 1)) {
			if (matches[0]!.authorProfileId) next.authorProfileId = matches[0]!.authorProfileId;
			if (matches[0]!.institutions?.length) next.institutions = matches[0]!.institutions;
		}
		return next;
	});
}
