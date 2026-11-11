/** How a library labels open access (`content.openAccessLabel`): open records only, open and closed ones, or none. */
export const OPEN_ACCESS_LABELS = ["open", "both", "off"] as const;
export type OpenAccessLabel = (typeof OPEN_ACCESS_LABELS)[number];

/** The access a record's label names under the library's setting, or null when it shows none. */
export function shownOpenAccess(openAccess: boolean | null | undefined, label: OpenAccessLabel) {
	if (typeof openAccess !== "boolean" || label === "off") return null;
	return openAccess || label === "both" ? openAccess : null;
}

/** An editor's open-access choice in words: open, closed, or not chosen, which follows what is listed for the record. */
export function describeOpenAccessChoice(value: unknown) {
	return value === true ? "Open access" : value === false ? "Closed access" : "Not chosen";
}
