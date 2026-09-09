import type { AdminCreator } from "./types";

function creatorIdentity(creator: AdminCreator) {
	return JSON.stringify([
		creator.creatorType, creator.name ?? null,
		creator.firstName ?? null, creator.lastName ?? null,
	]);
}

/** Source providers cannot assign profiles; carry existing links only across unambiguous authors. */
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
		const identity = creatorIdentity(creator);
		const matches = unchangedOrder ? [previous![index]!] : previousByIdentity.get(identity);
		if (matches?.length === 1 && (unchangedOrder || incomingCounts.get(identity) === 1) && matches[0]!.authorProfileId) {
			next.authorProfileId = matches[0]!.authorProfileId;
		}
		return next;
	});
}
