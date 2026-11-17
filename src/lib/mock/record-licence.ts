"use client";

// MOCK: a record's licence, kept in this browser until records store it. Nothing here reaches the server: the DOI
// still deposits under the community's Zenodo licence until the build sends the record's own.

import { useSyncExternalStore } from "react";

import { licenceFromRights } from "@/lib/publication/zenodo-licences";

/** A licence from Zenodo's list by its id, or another licence by its name and link. */
export type RecordLicence = { kind: "zenodo"; id: string } | { kind: "custom"; name: string; url: string };

/**
 * Where the licence came from: the community's default licence (a record made by hand), its rights statement (an
 * import that named one), a person's choice, or nowhere yet (an import that named none).
 */
export type LicenceOrigin = "default" | "found" | "picked" | "none";

export type LicenceState = { licence: RecordLicence | null; from: LicenceOrigin };

const PREFIX = "mock:record-licence:";
const listeners = new Set<() => void>();

const read = (key: string) => {
	try {
		return localStorage.getItem(PREFIX + key);
	} catch {
		return null;
	}
};

const subscribe = (changed: () => void) => {
	listeners.add(changed);
	const heard = (event: StorageEvent) => event.key?.startsWith(PREFIX) && changed();
	addEventListener("storage", heard);
	return () => {
		listeners.delete(changed);
		removeEventListener("storage", heard);
	};
};

export function setRecordLicence(key: string, licence: RecordLicence | null) {
	try {
		if (licence) localStorage.setItem(PREFIX + key, JSON.stringify(licence));
		else localStorage.removeItem(PREFIX + key);
	} catch {
		// Private windows may refuse storage: the record then keeps the licence it started with.
	}
	for (const changed of listeners) changed();
}

/** What a record starts with before anyone picks: what its rights name, else the default when it was made by hand. */
export function startingLicence(rights: unknown, imported: boolean, defaultLicence: string): LicenceState {
	const found = licenceFromRights(typeof rights === "string" ? rights : null);
	if (found) return { licence: { kind: "zenodo", id: found }, from: "found" };
	return imported ? { licence: null, from: "none" } : { licence: { kind: "zenodo", id: defaultLicence }, from: "default" };
}

/** Whether a licence can go out with a DOI: one of Zenodo's, or another with both its name and a web link. */
export function licenceComplete(licence: RecordLicence | null): licence is RecordLicence {
	if (!licence) return false;
	return licence.kind === "zenodo" || (Boolean(licence.name) && URL.canParse(licence.url) && /^https?:/u.test(licence.url));
}

const stateOf = (raw: string | null, start: LicenceState): LicenceState => (raw ? { licence: JSON.parse(raw) as RecordLicence, from: "picked" } : start);

/** The record's licence: the one picked for it, or the one it starts with. */
export function useRecordLicence(key: string, start: LicenceState): LicenceState {
	return stateOf(useSyncExternalStore(subscribe, () => read(key), () => null), start);
}

let version = 0;
subscribeAll();
function subscribeAll() {
	if (typeof window !== "undefined") subscribe(() => version++);
}

/** Every record's licence at once, for a list: read each with the function it returns. Renders again when any changes. */
export function useLicences() {
	useSyncExternalStore(subscribe, () => version, () => 0);
	return (key: string, start: LicenceState) => stateOf(read(key), start);
}
