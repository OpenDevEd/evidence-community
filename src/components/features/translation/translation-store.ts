"use client";

import { useSyncExternalStore } from "react";

/**
 * Translations this browser has made, by language and record, kept in localStorage so a record is translated once:
 * on the results, on its item page and on the next visit.
 */
const STORAGE_KEY = "record-translations-v1";

export type TitleTranslation = { title: string; source: string; same: boolean };
/** Replaced, never changed in place, so components that read it render again when it changes. */
export type TranslationStore = {
	readonly titles: Readonly<Record<string, TitleTranslation>>;
	readonly abstracts: Readonly<Record<string, string>>;
};

let snapshot: TranslationStore | null = null;
const listeners = new Set<() => void>();

function load(): TranslationStore {
	if (snapshot) return snapshot;
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as TranslationStore | null;
		snapshot = parsed?.titles && parsed?.abstracts ? parsed : { titles: {}, abstracts: {} };
	} catch {
		snapshot = { titles: {}, abstracts: {} };
	}
	return snapshot;
}

function save(next: TranslationStore) {
	snapshot = next;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Full or blocked storage: the translations still serve this page from memory.
	}
	listeners.forEach((listener) => listener());
}

const id = (target: string, key: string) => `${target}:${key}`;

export const titleIn = (store: TranslationStore | null, target: string, key: string) =>
	store?.titles[id(target, key)];
export const abstractIn = (store: TranslationStore | null, target: string, key: string) =>
	store?.abstracts[id(target, key)];

export function saveTitles(target: string, titles: Record<string, TitleTranslation>) {
	const current = load();
	save({
		...current,
		titles: { ...current.titles, ...Object.fromEntries(Object.entries(titles).map(([key, title]) => [id(target, key), title])) },
	});
}

export function saveAbstracts(target: string, abstracts: Record<string, string>) {
	const current = load();
	save({
		...current,
		abstracts: {
			...current.abstracts,
			...Object.fromEntries(Object.entries(abstracts).map(([key, abstract]) => [id(target, key), abstract])),
		},
	});
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
