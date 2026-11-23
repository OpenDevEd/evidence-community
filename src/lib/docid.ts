/**
 * A record's DOCiD (OpenDevEd/evidence-community#934): the Africa PID Alliance's identifier, a Handle under
 * 20.500.14351. Communities don't register DOCiDs; a record keeps the one it came with as a line of its Extra,
 * "DOCiD: 20.500.14351/…", as Zotero keeps identifiers it has no field for, or carries it as its address.
 */
const HANDLE = /^20\.500\.14351\/[^\s/][^\s]*$/u;
const LINE = /^\s*DOCiD:\s*(\S+)\s*$/imu;
const ADDRESS = /^https?:\/\/hdl\.handle\.net\/(20\.500\.14351\/[^\s?#]+)/iu;

/** A Handle as DOCiD gives it, or null for anything that isn't one of DOCiD's. */
export function normalizeDocid(value: string | null | undefined) {
	const handle = value?.trim().replace(/^https?:\/\/hdl\.handle\.net\//iu, "");
	return handle && HANDLE.test(handle) ? handle : null;
}

/** The DOCiD a record came with: from its Extra, else from its address. */
export function docidOf(record: { extra?: string | null; url?: string | null }) {
	return normalizeDocid(record.extra?.match(LINE)?.[1]) ?? normalizeDocid(record.url?.match(ADDRESS)?.[1]);
}

export const docidUrl = (handle: string) => `https://hdl.handle.net/${handle}`;

/** The Extra line a record keeps its DOCiD on. */
export const docidLine = (handle: string) => `DOCiD: ${handle}`;
