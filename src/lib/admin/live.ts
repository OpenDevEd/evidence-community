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
	/** The listening connection, or the attempt to open it. */
	listening: Promise<Client | null> | null;
	databaseUrl: string | null;
	/** Whether notices may have been missed since pages were last told, so they read everything once it listens again. */
	missed: boolean;
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
	databaseUrl: null,
	missed: false,
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

function lost(client: Client, error?: unknown) {
	// A connection that was replaced, or closed on purpose, has nothing to recover.
	void hub.listening?.then((current) => {
		if (current !== client) return;
		if (error) console.error("The admin's change listener lost its database connection", error);
		hub.listening = null;
		hub.missed = true;
		void client.end().catch(() => undefined);
		retry();
	});
}

function retry() {
	if (!hub.pages.size || hub.retryTimer) return;
	const wait = RETRY_MS[Math.min(hub.failures, RETRY_MS.length - 1)]!;
	hub.failures += 1;
	hub.retryTimer = setTimeout(() => {
		hub.retryTimer = null;
		if (hub.pages.size) void listen();
	}, wait);
}

async function open(databaseUrl: string) {
	// TCP keep-alive, so a connection the network dropped without a word is noticed.
	const client = new Client({ connectionString: databaseUrl, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
	try {
		await client.connect();
		client.on("notification", (notice) => gather(notice.payload ?? ""));
		client.on("error", (error) => lost(client, error));
		client.on("end", () => lost(client));
		await client.query(`LISTEN ${ADMIN_LIVE_CHANNEL}`);
	} catch (error) {
		console.error("The admin's change listener could not reach the database", error);
		void client.end().catch(() => undefined);
		hub.listening = null;
		hub.missed = true;
		retry();
		return null;
	}
	hub.failures = 0;
	if (hub.missed) {
		hub.missed = false;
		tellPages({ all: true });
	}
	return client;
}

/** Listens on the library's database as its configuration has it now, replacing a listener on an older address. */
async function listen() {
	const databaseUrl = (await getLibraryConfig()).services.database.url;
	if (hub.listening && hub.databaseUrl === databaseUrl) return;
	const replaced = hub.listening;
	hub.databaseUrl = databaseUrl;
	hub.missed ||= Boolean(replaced);
	hub.listening = open(databaseUrl);
	void replaced?.then((client) => client?.end()).catch(() => undefined);
}

async function stopListening() {
	const closing = hub.listening;
	hub.listening = null;
	hub.missed = false;
	hub.failures = 0;
	if (hub.retryTimer) clearTimeout(hub.retryTimer);
	hub.retryTimer = null;
	await closing?.then((client) => client?.end()).catch(() => undefined);
}

function subscribe(tell: Tell) {
	hub.pages.add(tell);
	if (hub.lingerTimer) clearTimeout(hub.lingerTimer);
	hub.lingerTimer = null;
	void listen().catch((error: unknown) => {
		console.error("The admin's change listener could not start", error);
		hub.missed = true;
		retry();
	});
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
			const keepAlive = setInterval(() => write(": keep-alive\n\n"), KEEP_ALIVE_MS);
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
