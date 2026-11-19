"use client";

import { useSyncExternalStore } from "react";

/**
 * Translations this browser has made, by language and record, kept in localStorage so a record is translated once:
 * on the results, on its item page and on the next visit.
 */
const STORAGE_KEY = "record-translations-v1";

/**
 * About 800 records with full abstracts. Past it the oldest saves go first: the server keeps every translation, so a
 * dropped one costs a request, not a translation.
 */
const STORAGE_LIMIT_CHARACTERS = 1_000_000;

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

/** Drops the oldest saves until the store fits. Object keys keep insertion order, and every save re-inserts its keys. */
function capped(store: TranslationStore): TranslationStore {
	const titles = Object.entries(store.titles);
	const abstracts = Object.entries(store.abstracts);
	let size = JSON.stringify(store).length;
	while (size > STORAGE_LIMIT_CHARACTERS && (titles.length > 0 || abstracts.length > 0)) {
		const dropped = abstracts.length > 0 ? abstracts.shift()! : titles.shift()!;
		size -= JSON.stringify(dropped).length;
	}
	return { titles: Object.fromEntries(titles), abstracts: Object.fromEntries(abstracts) };
}

/** The entries without the given ids, so saving them again moves them to the newest end. */
const without = <T,>(entries: Readonly<Record<string, T>>, ids: string[]) =>
	Object.fromEntries(Object.entries(entries).filter(([key]) => !ids.includes(key)));

function save(next: TranslationStore) {
	next = capped(next);
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
	const added = Object.entries(titles).map(([key, title]) => [id(target, key), title] as const);
	save({ ...current, titles: { ...without(current.titles, added.map(([key]) => key)), ...Object.fromEntries(added) } });
}

export function saveAbstracts(target: string, abstracts: Record<string, string>) {
	const current = load();
	const added = Object.entries(abstracts).map(([key, abstract]) => [id(target, key), abstract] as const);
	save({ ...current, abstracts: { ...without(current.abstracts, added.map(([key]) => key)), ...Object.fromEntries(added) } });
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
