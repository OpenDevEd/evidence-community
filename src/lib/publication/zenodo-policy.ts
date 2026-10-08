import type { ZenodoIdentifierPolicy, ZenodoPublicationEnvironment } from "@/db/schema/publication";
import type { PublicationRepositorySnapshot } from "./repository";
import { ZenodoIdentifierPolicyLockedError } from "./errors";
import { zenodoPolicyChangeReason } from "./identifier-policy";

function zenodoHasStarted(snapshot: PublicationRepositorySnapshot, environment: ZenodoPublicationEnvironment) {
	return (
		snapshot.identifiers.some(
			(identifier) =>
				identifier.registrar === "zenodo" &&
				identifier.environment === environment,
		) ||
		snapshot.states.some(
			(state) =>
				state.provider === "zenodo" &&
				state.environment === environment &&
				Boolean(
					state.lastPayloadHash ||
					state.zenodoRecordId ||
					state.unpublishedDraftDepositionId,
				),
		) ||
		snapshot.journals.some(
			(journal) =>
				journal.provider === "zenodo" &&
				journal.environment === environment,
		) ||
		snapshot.jobs.some(
			(job) =>
				job.provider === "zenodo" &&
				job.environment === environment &&
				Boolean(job.processedAt || job.leaseOwner),
		)
	);
}
export function lockedZenodoIdentifierPolicy(
	snapshot: PublicationRepositorySnapshot,
	environment: ZenodoPublicationEnvironment,
): ZenodoIdentifierPolicy | null {
	const target = snapshot.targets.find(
		(target) => target.provider === "zenodo" && target.environment === environment,
	);
	return target?.identifierPolicy && zenodoHasStarted(snapshot, environment)
		? target.identifierPolicy
		: null;
}

export function assertZenodoPolicyMayChange(
	snapshot: PublicationRepositorySnapshot,
	policy: ZenodoIdentifierPolicy,
	environment: ZenodoPublicationEnvironment,
) {
	const locked = lockedZenodoIdentifierPolicy(snapshot, environment);
	if (zenodoPolicyChangeReason(locked, policy))
		throw new ZenodoIdentifierPolicyLockedError();
}
