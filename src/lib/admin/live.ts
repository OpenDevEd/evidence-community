import "server-only";

import { Client } from "pg";

import { getLibraryConfig } from "@/config/library-config/server";

import { ADMIN_LIVE_CHANNEL, ADMIN_LIVE_TABLES, type AdminLiveMessage, type AdminLiveTopic } from "./live-contract";

type Tell = (message: AdminLiveMessage) => void;

/** Changes are gathered this long before the pages hear of them, so a burst of writes is one message. */
const GATHER_MS = 200;
/** The listener outlives its last page by this long, so a reload doesn't connect to the database again. */
const LINGER_MS = 30_000;
/** How long to wait before listening again after the database connection is lost, longer each time. */
const RETRY_MS = [1_000, 2_000, 5_000, 15_000];
/** Under Cloudflare's 100 seconds of silence, after which it closes a stream. */
const KEEP_ALIVE_MS = 25_000;

/**
 * One Postgres connection per web server listens for the database's change notices while an admin page is open, and
 * tells every open page which parts to read again. It carries no data: a page reads through its own requests, with its
 * own access.
 */
type Hub = {
	pages: Set<Tell>;
	/** The listening connection, or the attempt to open it. Null while there is none. */
	listening: Promise<Client | null> | null;
	/** Counts the attempts to listen, so one that was replaced while it connected changes nothing when it ends. */
	attempt: number;
	/** Counts the listeners that came up. Each one tells every page to read everything, since nothing was heard before it. */
	listeners: number;
	databaseUrl: string | null;
	failures: number;
	gathered: Set<AdminLiveTopic>;
	gatherTimer: ReturnType<typeof setTimeout> | null;
	lingerTimer: ReturnType<typeof setTimeout> | null;
	retryTimer: ReturnType<typeof setTimeout> | null;
};

const globalHub = globalThis as typeof globalThis & { __evidenceLibraryAdminLive?: Hub };
const hub = (globalHub.__evidenceLibraryAdminLive ??= {
	pages: new Set(),
	listening: null,
	attempt: 0,
	listeners: 0,
	databaseUrl: null,
	failures: 0,
	gathered: new Set(),
	gatherTimer: null,
	lingerTimer: null,
	retryTimer: null,
});

function tellPages(message: AdminLiveMessage) {
	for (const tell of hub.pages) tell(message);
}

function tellGathered() {
	hub.gatherTimer = null;
	const topics = [...hub.gathered];
	hub.gathered.clear();
	tellPages({ topics });
}

function gather(table: string) {
	const topics = ADMIN_LIVE_TABLES[table];
	if (!topics) return;
	for (const topic of topics) hub.gathered.add(topic);
	hub.gatherTimer ??= setTimeout(tellGathered, GATHER_MS);
}

/** Listens again after a wait, longer each time, while a page is still open. */
function retry() {
	if (!hub.pages.size || hub.retryTimer) return;
	const wait = RETRY_MS[Math.min(hub.failures, RETRY_MS.length - 1)]!;
	hub.failures += 1;
	hub.retryTimer = setTimeout(() => {
		hub.retryTimer = null;
		listenAgain();
	}, wait);
}

function lost(client: Client, error?: unknown) {
	// A connection that was replaced, or closed on purpose, has nothing to recover.
	void hub.listening?.then((current) => {
		if (current !== client) return;
		if (error) console.error("The admin's change listener lost its database connection", error);
		hub.listening = null;
		void client.end().catch(() => undefined);
		retry();
	});
}

async function open(databaseUrl: string, attempt: number) {
	// TCP keep-alive, so a connection the network dropped without a word is noticed.
	const client = new Client({ connectionString: databaseUrl, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
	try {
		await client.connect();
		client.on("notification", (notice) => gather(notice.payload ?? ""));
		client.on("error", (error) => lost(client, error));
		client.on("end", () => lost(client));
		await client.query(`LISTEN ${ADMIN_LIVE_CHANNEL}`);
	} catch (error) {
		void client.end().catch(() => undefined);
		if (attempt === hub.attempt) failedToListen(error);
		return null;
	}
	// Replaced while it connected: the newer attempt is the listener, and this one must not stay beside it.
	if (attempt !== hub.attempt) {
		void client.end().catch(() => undefined);
		return null;
	}
	hub.failures = 0;
	hub.listeners += 1;
	// Whatever changed before this moment went unheard, for pages that waited through a lost connection and for
	// pages that have only just arrived.
	tellPages({ all: true });
	return client;
}

function failedToListen(error: unknown) {
	console.error("The admin's change listener could not reach the database", error);
	hub.listening = null;
	retry();
}

/**
 * Resolves once the library's database is listened to, as its configuration has it now: true when it is. A listener
 * on an address an older configuration had is replaced.
 */
async function listening() {
	const databaseUrl = (await getLibraryConfig()).services.database.url;
	if (!hub.listening || hub.databaseUrl !== databaseUrl) {
		const replaced = hub.listening;
		hub.databaseUrl = databaseUrl;
		hub.attempt += 1;
		hub.listening = open(databaseUrl, hub.attempt);
		void replaced?.then((client) => client?.end()).catch(() => undefined);
	}
	return (await hub.listening) !== null;
}

/** Makes sure the database is listened to, for a page that is open: a failure is tried again after a wait. */
function listenAgain() {
	if (hub.pages.size) void listening().catch(failedToListen);
}

async function stopListening() {
	const closing = hub.listening;
	hub.listening = null;
	// An attempt still connecting is not the listener any more.
	hub.attempt += 1;
	hub.failures = 0;
	if (hub.retryTimer) clearTimeout(hub.retryTimer);
	hub.retryTimer = null;
	await closing?.then((client) => client?.end()).catch(() => undefined);
}

/** A page that arrives while the listener is already up reads everything once, for what changed since it was served. */
async function tellWhenListening(tell: Tell) {
	const listeners = hub.listeners;
	const ready = await listening();
	// A listener that came up meanwhile has told every page, this one included.
	if (ready && listeners === hub.listeners && hub.pages.has(tell)) tell({ all: true });
}

function subscribe(tell: Tell) {
	hub.pages.add(tell);
	if (hub.lingerTimer) clearTimeout(hub.lingerTimer);
	hub.lingerTimer = null;
	void tellWhenListening(tell).catch(failedToListen);
	return () => {
		hub.pages.delete(tell);
		if (hub.pages.size || hub.lingerTimer) return;
		hub.lingerTimer = setTimeout(() => {
			hub.lingerTimer = null;
			if (!hub.pages.size) void stopListening();
		}, LINGER_MS);
	};
}

/** The stream one admin page listens on until it closes: a message for each burst of changes, and a keep-alive line. */
export function adminLiveResponse(signal: AbortSignal) {
	const encoder = new TextEncoder();
	let close = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const write = (text: string) => {
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					// The page went away between the notice and the write.
					close();
				}
			};
			// How long the browser waits before it opens the stream again after losing it.
			write("retry: 3000\n\n");
			const unsubscribe = subscribe((message) => write(`data: ${JSON.stringify(message)}\n\n`));
			// With each keep-alive the listener is checked: a configuration that moved the database since, or a listener
			// that went without a retry, is put right within one beat.
			const keepAlive = setInterval(() => {
				write(": keep-alive\n\n");
				listenAgain();
			}, KEEP_ALIVE_MS);
			close = () => {
				close = () => {};
				clearInterval(keepAlive);
				unsubscribe();
				signal.removeEventListener("abort", close);
				try {
					controller.close();
				} catch {
					// Already closed by the browser.
				}
			};
			if (signal.aborted) close();
			else signal.addEventListener("abort", close);
		},
		cancel() {
			close();
		},
	});
	return new Response(stream, {
		headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform" },
	});
}
