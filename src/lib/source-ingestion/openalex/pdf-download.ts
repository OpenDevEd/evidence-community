import { fetchPublicFile } from "@/lib/public-fetch";

// A slow download may take its full time as long as bytes keep arriving.
const PDF_DOWNLOAD = { accept: "application/pdf", timeoutMs: 120_000, idleTimeoutMs: 30_000 };
const PDF_HEADER = Buffer.from("%PDF-");
// Other copies are tried only while the record has spent less than this; a page waits for its slowest record.
const FALLBACK_BUDGET_MS = 60_000;
// Unpaywall asks callers to name themselves by email; this is the platform's.
const UNPAYWALL_EMAIL = "support@openscholar.ai";

/** A PDF may carry a short preamble before its header, so the header is looked for in the first kilobyte. */
export const isPdf = (bytes: Uint8Array) => {
	const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1_024)).indexOf(PDF_HEADER);
	return header >= 0;
};

// Connection errors that mean the host did not answer at all, as opposed to an answer we could not use.
const CONNECT_FAILURES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"]);
// Fallback copies do not go through the stage's per-host lanes, so they keep the same limit here.
const FALLBACK_PER_HOST = 4;
const UNREACHABLE_AFTER = 3;
const UNREACHABLE_FOR_MS = 30 * 60_000;

/**
 * Hosts that failed to connect several times in a row, skipped for half an hour. A dead host otherwise costs ten
 * seconds a link, four links at a time, and the page waiting on those links holds every page behind it.
 */
const unreachable = new Map<string, { failures: number; until: number }>();

/** The host that did not answer, when the request failed to connect at all. */
function unansweredHost(error: unknown) {
	const failure = error as { cause?: { code?: unknown }; host?: unknown } | null;
	const code = failure?.cause?.code;
	return error instanceof TypeError && typeof code === "string" && CONNECT_FAILURES.has(code) && typeof failure?.host === "string"
		? failure.host
		: null;
}

async function fetchFromHost(url: URL, options: Parameters<typeof fetchPublicFile>[1]) {
	const state = unreachable.get(url.hostname);
	if (state && state.until > Date.now()) {
		throw new Error(`${url.hostname} did not accept connections, so it is skipped for now`);
	}
	try {
		const result = await fetchPublicFile(url, options);
		unreachable.delete(url.hostname);
		return result;
	} catch (error) {
		const host = unansweredHost(error);
		if (host) {
			// Read now, not before the request: other downloads from the host fail at the same time.
			const failures = (unreachable.get(host)?.failures ?? 0) + 1;
			unreachable.set(host, { failures, until: failures >= UNREACHABLE_AFTER ? Date.now() + UNREACHABLE_FOR_MS : 0 });
		} else {
			// Any other failure came from a host that answered.
			unreachable.delete(url.hostname);
		}
		throw error;
	}
}

const hostSlots = new Map<string, { active: number; waiting: (() => void)[] }>();

/** Runs a fallback request once fewer than FALLBACK_PER_HOST are running against its host. */
async function withHostSlot<T>(host: string, run: () => Promise<T>): Promise<T> {
	const slots = hostSlots.get(host) ?? { active: 0, waiting: [] };
	hostSlots.set(host, slots);
	while (slots.active >= FALLBACK_PER_HOST) await new Promise<void>((wake) => slots.waiting.push(wake));
	slots.active++;
	try {
		return await run();
	} finally {
		slots.active--;
		slots.waiting.shift()?.();
		if (slots.active === 0 && slots.waiting.length === 0) hostSlots.delete(host);
	}
}

/** The time a fetch may take: the usual limit, or less when the record's deadline comes first. */
function timeLeft(deadline: number | undefined) {
	const left = deadline === undefined ? PDF_DOWNLOAD.timeoutMs : Math.min(PDF_DOWNLOAD.timeoutMs, deadline - Date.now());
	if (left <= 0) throw new Error("No time was left to try this copy");
	return left;
}

/** The PDF a landing page names in its `citation_pdf_url` meta tag, which scholarly sites publish for indexers. */
function landingPagePdfUrl(html: string, base: URL) {
	for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
		if (!/\bname\s*=\s*["']citation_pdf_url["']/iu.test(tag)) continue;
		const content = /\bcontent\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.replaceAll("&amp;", "&");
		if (!content) return null;
		try {
			const url = new URL(content, base);
			return url.protocol === "https:" || url.protocol === "http:" ? url : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Many OpenAlex PDF links open the article's landing page instead. Its
 * `citation_pdf_url` is followed once, so the PDF behind it is published.
 */
async function downloadPdf(url: URL, maxBytes: number, deadline?: number) {
	const { data, contentType, url: landing } = await fetchFromHost(url, { ...PDF_DOWNLOAD, timeoutMs: timeLeft(deadline), maxBytes });
	// Some landing pages come without an HTML content type, so the body is looked at too.
	const looksLikeHtml = /html/iu.test(contentType) || /^\s*</u.test(new TextDecoder().decode(data.subarray(0, 512)));
	if (isPdf(data) || !looksLikeHtml) return data;
	const linked = landingPagePdfUrl(new TextDecoder().decode(data), landing);
	if (!linked) return data;
	return (await fetchFromHost(linked, { ...PDF_DOWNLOAD, timeoutMs: timeLeft(deadline), maxBytes })).data;
}

function httpUrls(values: unknown[]) {
	return values.flatMap((value) => {
		if (typeof value !== "string") return [];
		try {
			const url = new URL(value);
			return url.protocol === "https:" || url.protocol === "http:" ? [url] : [];
		} catch {
			return [];
		}
	});
}

/** The open copies Unpaywall lists for a DOI, PDF links first; none when it does not answer. */
async function unpaywallCopies(doi: string) {
	try {
		const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
		url.searchParams.set("email", UNPAYWALL_EMAIL);
		const { data } = await withHostSlot(url.hostname, () => fetchFromHost(url, { accept: "application/json", timeoutMs: 10_000, maxBytes: 1_000_000 }));
		const locations = (JSON.parse(new TextDecoder().decode(data)) as { oa_locations?: { url_for_pdf?: unknown; url_for_landing_page?: unknown }[] }).oa_locations ?? [];
		return httpUrls([...locations.map((location) => location.url_for_pdf), ...locations.map((location) => location.url_for_landing_page)]);
	} catch (error) {
		console.warn("Unpaywall did not answer", { doi, error: error instanceof Error ? error.message : String(error) });
		return [];
	}
}

/** Where to look for the work's PDF, in order. Unpaywall is asked only once the others have failed. */
async function* copiesOf(link: string, raw: Record<string, unknown>, inTime: () => boolean) {
	yield new URL(link);
	yield* httpUrls(Array.isArray(raw.otherCopies) ? raw.otherCopies : []);
	if (typeof raw.doi === "string" && inTime()) yield* await unpaywallCopies(raw.doi);
}

/** The chosen link runs in the stage's lane; a fallback waits for a host slot and ends at the record's deadline. */
async function tryCopy(url: URL, maxBytes: number, deadline?: number): Promise<{ bytes: Uint8Array } | { error: unknown }> {
	try {
		const bytes = deadline === undefined ? await downloadPdf(url, maxBytes) : await withHostSlot(url.hostname, () => downloadPdf(url, maxBytes, deadline));
		return { bytes };
	} catch (error) {
		return { error };
	}
}

/**
 * The work's PDF from its chosen link, else from its other open copies, else from the copies Unpaywall knows, trying
 * each while the record has time left. With no PDF anywhere, the chosen link's failure stands: its error, or what it
 * returned, so the record's issue says what went wrong with the link it shows.
 */
export async function downloadAnyCopy(link: string, raw: Record<string, unknown>, maxBytes: number): Promise<Uint8Array> {
	const started = Date.now();
	const tried = new Set<string>();
	let chosen: { bytes: Uint8Array } | { error: unknown } | undefined;
	const inTime = () => Date.now() - started < FALLBACK_BUDGET_MS;
	for await (const url of copiesOf(link, raw, inTime)) {
		if (chosen && !inTime()) break;
		if (tried.has(url.href)) continue;
		tried.add(url.href);
		const outcome = await tryCopy(url, maxBytes, chosen ? started + FALLBACK_BUDGET_MS : undefined);
		if ("bytes" in outcome && isPdf(outcome.bytes)) return outcome.bytes;
		chosen ??= outcome;
	}
	if (chosen && "bytes" in chosen) return chosen.bytes;
	throw chosen && "error" in chosen ? chosen.error : new Error("The work has no PDF link");
}
