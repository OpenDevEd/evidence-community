"use client";

import { useEffect, useEffectEvent } from "react";

import { ADMIN_LIVE_PATH, ADMIN_LIVE_TOPICS, type AdminLiveMessage, type AdminLiveTopic } from "@/lib/admin/live-contract";

/**
 * The admin page hears what other people and the workers change, and each part of it reads itself again: nobody
 * reloads. One stream serves the whole page. It carries no data, only which parts changed.
 */
type Reader = { topics: ReadonlySet<AdminLiveTopic>; changed: () => void };

const readers = new Set<Reader>();
let stream: EventSource | null = null;
let reopenTimer = 0;
let hiddenTimer = 0;
/** Until when this page's own saves keep a read waiting, so typing isn't answered by a read after every save. */
let ownWriteUntil = 0;

/** A read waits this long after the page's own last save. */
const AFTER_OWN_WRITE_MS = 1_500;
/** How long to wait before opening a stream the server closed, which the browser doesn't reopen by itself. */
const REOPEN_MS = 15_000;
/** A tab in the background keeps its stream this long, so a glance at another tab doesn't cost a reconnection. */
const HIDDEN_CLOSE_MS = 5_000;
/** How many reads a part makes in quick succession before it slows down. */
const BURST = 4;
/** How often a part reads once changes keep coming past that, as during an import of thousands of records. */
const SLOWEST_MS = 15_000;

function tell(topics: readonly AdminLiveTopic[]) {
	for (const reader of readers) if (topics.some((topic) => reader.topics.has(topic))) reader.changed();
}

function open() {
	stream = new EventSource(ADMIN_LIVE_PATH);
	// The server says "all" once it listens for this stream, each time the stream opens: whatever changed since the
	// page was read, or while the stream was closed, went unheard.
	stream.onmessage = (event: MessageEvent<string>) => {
		const message = JSON.parse(event.data) as AdminLiveMessage;
		tell("all" in message ? ADMIN_LIVE_TOPICS : message.topics);
	};
	stream.onerror = () => {
		// The browser reopens a stream the network dropped. One the server refused stays closed, so it is opened again here.
		if (stream?.readyState !== EventSource.CLOSED || reopenTimer) return;
		reopenTimer = window.setTimeout(() => {
			reopenTimer = 0;
			if (readers.size && !document.hidden) open();
		}, REOPEN_MS);
	};
}

function close() {
	stream?.close();
	stream = null;
	window.clearTimeout(reopenTimer);
	reopenTimer = 0;
	window.clearTimeout(hiddenTimer);
	hiddenTimer = 0;
}

/**
 * Only a tab someone is looking at holds a stream. Over HTTP/1.1 a browser allows six connections to a site, shared by
 * all its tabs, so six admin tabs each holding one would leave none for the pages' own requests. A tab in the
 * background lets its stream go, and when it comes back it opens one again and the server has it read everything once.
 */
function followVisibility() {
	window.clearTimeout(hiddenTimer);
	hiddenTimer = 0;
	if (document.hidden) hiddenTimer = window.setTimeout(close, HIDDEN_CLOSE_MS);
	else if (!stream && readers.size) open();
}

/** The page saved something itself, and reads what it changed itself: reads for the change it caused wait a moment. */
export function noteOwnAdminWrite(method = "GET") {
	if (method !== "GET") ownWriteUntil = Date.now() + AFTER_OWN_WRITE_MS;
}

/**
 * A read that never runs twice at once, whoever asks: asked for while it runs, it reads once more when done, so the
 * answer on screen is never older than the last request for it. Two parts of the page can ask for the same read, and
 * when they ask in the same moment, as for one message that names both, one read answers both: it hasn't left yet.
 */
export function oneAtATime(read: () => Promise<unknown>) {
	let running: Promise<void> | null = null;
	let again = false;
	let leaving = false;
	const readUntilAsked = async () => {
		try {
			do {
				again = false;
				leaving = true;
				queueMicrotask(() => (leaving = false));
				await read();
			} while (again);
		} finally {
			running = null;
		}
	};
	return () => {
		again = running !== null && !leaving;
		running ??= readUntilAsked();
		return running;
	};
}

/** Starts a read now and resolves when it is done, whether it worked or not: a read that failed waits for the next change. */
async function started(read: () => unknown) {
	try {
		await read();
	} catch {
		// The part stays as it is.
	}
}

/**
 * Paces one part's reads. `changed` asks for a read: at once for a change on its own, and for the few that follow
 * within moments. After BURST reads in a row it reads once every SLOWEST_MS, with a last read after the changes stop,
 * so an import, or a colleague typing, doesn't make every open page ask for its list several times a second. A quiet
 * minute earns the quick reads back. A hidden tab reads once when it is `shown` again, and a read still under way is
 * waited for, so a part never reads itself twice at once.
 */
export function paceReads(read: () => unknown, every: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let waiting = false;
	let reading = false;
	let stopped = false;
	// A part is read as it mounts, so it counts as just read: the "read everything" that comes as the stream opens is
	// then read a moment later, once the page has loaded, instead of asking for everything a second time mid-load.
	let lastRead = Date.now();
	let quickReads = BURST;
	let earningSince = 0;
	const run = () => {
		timer = null;
		if (document.hidden) return;
		const now = Date.now();
		const earned = Math.floor((now - earningSince) / SLOWEST_MS);
		if (earned > 0) {
			quickReads = Math.min(BURST, quickReads + earned);
			earningSince += earned * SLOWEST_MS;
		}
		const wait = Math.max(lastRead + every, ownWriteUntil, quickReads > 0 ? 0 : earningSince + SLOWEST_MS) - now;
		if (wait > 0) {
			timer = setTimeout(run, wait);
			return;
		}
		waiting = false;
		// The next quick read is earned from the first one spent.
		if (quickReads === BURST) earningSince = now;
		quickReads -= 1;
		lastRead = now;
		reading = true;
		void started(read).finally(() => {
			reading = false;
			if (waiting) ask();
		});
	};
	const ask = () => {
		if (!timer && !reading && !stopped) run();
	};
	return {
		changed: () => {
			waiting = true;
			ask();
		},
		shown: () => {
			if (waiting) ask();
		},
		stop: () => {
			// A read under way finishes, and nothing reads after it.
			stopped = true;
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}

function subscribe(topics: readonly AdminLiveTopic[], read: () => void, every: number) {
	const paced = paceReads(read, every);
	const reader: Reader = { topics: new Set(topics), changed: paced.changed };
	if (!readers.size) document.addEventListener("visibilitychange", followVisibility);
	readers.add(reader);
	document.addEventListener("visibilitychange", paced.shown);
	if (!stream && !document.hidden) open();
	return () => {
		readers.delete(reader);
		document.removeEventListener("visibilitychange", paced.shown);
		paced.stop();
		if (readers.size) return;
		document.removeEventListener("visibilitychange", followVisibility);
		close();
	};
}

/** Reads a part of the admin again whenever someone else, or a worker, changed it. */
export function useAdminLive(topics: readonly AdminLiveTopic[], read: () => unknown, every = 1_000) {
	const onChange = useEffectEvent(read);
	const key = topics.join(",");
	// The outside system is the page's EventSource on /api/admin/events.
	useEffect(() => subscribe(key.split(",") as AdminLiveTopic[], () => onChange(), every), [key, every]);
}
