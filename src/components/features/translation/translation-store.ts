"use client";

import { useSyncExternalStore } from "react";
import { textFingerprint } from "@/lib/text-fingerprint";
import type { RecordTranslation, TranslationPart } from "@/lib/translation-languages";

/**
 * Translations this browser has fetched, kept in localStorage so a record is fetched once: on the results, on its
 * item page and on the next visit.
 */
const STORAGE_KEY = "record-translations";

/**
 * About 800 records with full abstracts. Past it the oldest saves go first: the server keeps every translation, so a
 * dropped one costs a request, not a translation.
 */
const STORAGE_LIMIT_CHARACTERS = 1_000_000;

/** Replaced, never changed in place, so components that read it render again when it changes. */
export type TranslationStore = Readonly<Record<string, RecordTranslation>>;

let snapshot: TranslationStore | null = null;
const listeners = new Set<() => void>();

function load(): TranslationStore {
	if (snapshot) return snapshot;
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		snapshot = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TranslationStore) : {};
	} catch {
		snapshot = {};
	}
	return snapshot;
}

/** Drops the oldest saves until the store fits. Object keys keep insertion order, and every save re-inserts its keys. */
function capped(store: TranslationStore): TranslationStore {
	const entries = Object.entries(store);
	let size = JSON.stringify(store).length;
	while (size > STORAGE_LIMIT_CHARACTERS && entries.length > 0) size -= JSON.stringify(entries.shift()).length;
	return Object.fromEntries(entries);
}

/** Part, language, record and the fingerprint of the original: a changed original no longer matches. */
const id = (part: TranslationPart, language: string, key: string, fingerprint: string) =>
	`${part}:${language}:${key}:${fingerprint}`;

/** The stored translation of this original text, if any. */
export const translationIn = (
	store: TranslationStore | null,
	part: TranslationPart,
	language: string,
	key: string,
	original: string,
) => store?.[id(part, language, key, textFingerprint(original))];

/** Saves what the server sent, each under the fingerprint of the original it was made from. */
export function saveTranslations(part: TranslationPart, language: string, translations: Record<string, RecordTranslation>) {
	const added = Object.entries(translations).map(([key, translation]) => [id(part, language, key, translation.fingerprint), translation] as const);
	if (added.length === 0) return;
	const ids = new Set(added.map(([addedId]) => addedId));
	// Saving again moves an entry to the newest end, so the cap drops what was used longest ago.
	const kept = Object.entries(load()).filter(([storedId]) => !ids.has(storedId));
	snapshot = capped(Object.fromEntries([...kept, ...added]));
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
	} catch {
		// Full or blocked storage: the translations still serve this page from memory.
	}
	listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	// The storage event: another tab saved translations.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		snapshot = null;
		listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** The stored translations; null through hydration, so the server and the browser's first frame agree. */
export function useTranslationStore() {
	return useSyncExternalStore(subscribe, load, () => null);
}

/**
 * Records the reader chose to read translated in this tab, as `language:key`. The item page and the way back to the
 * results read the same choice; a reload starts from the originals unless automatic translation is on.
 */
let shown: ReadonlySet<string> = new Set();
const shownListeners = new Set<() => void>();
const NONE_SHOWN: ReadonlySet<string> = new Set();

export const shownKey = (language: string, key: string) => `${language}:${key}`;

export function setShown(language: string, keys: string[], on: boolean) {
	const next = new Set(shown);
	for (const key of keys) {
		if (on) next.add(shownKey(language, key));
		else next.delete(shownKey(language, key));
	}
	shown = next;
	shownListeners.forEach((listener) => listener());
}

function subscribeShown(listener: () => void) {
	shownListeners.add(listener);
	return () => {
		shownListeners.delete(listener);
	};
}

export function useShown() {
	return useSyncExternalStore(subscribeShown, () => shown, () => NONE_SHOWN);
}
