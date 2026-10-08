import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";

export const ZENODO_POLICY_LOCKED_MESSAGE =
	"This record has already been sent to Zenodo. Its DOI choice cannot be changed.";

export function zenodoPolicyChangeReason(
	locked: ZenodoIdentifierPolicy | null | undefined,
	requested: ZenodoIdentifierPolicy,
) {
	return locked && locked !== requested ? ZENODO_POLICY_LOCKED_MESSAGE : undefined;
}
