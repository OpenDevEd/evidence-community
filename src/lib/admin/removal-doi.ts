/**
 * What removing a record does to its DOI, from its active DOI targets in every environment: nothing (none), switch off
 * a test one (Zenodo sandbox, Crossref test), or withdraw it for a real one, which can't be deleted.
 */
export type RemovalDoi = "none" | "test" | "real";

export const removalDoiOf = (activeTargets: readonly { environment: string }[]): RemovalDoi =>
	activeTargets.some((target) => target.environment === "production") ? "real" : activeTargets.length ? "test" : "none";
