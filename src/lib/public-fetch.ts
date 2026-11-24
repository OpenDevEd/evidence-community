import "server-only";

import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";

const MAX_REDIRECTS = 5;

/**
 * Addresses outside the public internet, from the IANA special-purpose registries: private, loopback, link-local,
 * shared, benchmarking, documentation, reserved, multicast, and their IPv6 counterparts, including deprecated
 * site-local and IPv4 embedded in IPv6.
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
	["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
	["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	// IPv4 written as IPv6 (::ffff:0:0/96) is not listed: the block list checks every IPv4 address in that form, so
	// listing it would refuse all of them. Such addresses are judged as the IPv4 address they carry instead.
	["::", 128], ["::1", 128], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
	["2002::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) NOT_PUBLIC.addSubnet(network, prefix, "ipv6");

/** Whether an address is outside the public internet. An IPv4 address written as IPv6 is judged as that IPv4 address. */
export function isPrivateIp(address: string) {
	const version = isIP(address);
	if (version === 4) return NOT_PUBLIC.check(address, "ipv4");
	if (version !== 6) return true;
	const mapped = mappedIpv4(address);
	return mapped ? NOT_PUBLIC.check(mapped, "ipv4") : NOT_PUBLIC.check(address, "ipv6");
}

/**
 * The IPv4 address carried inside an IPv6 one, written either way ("::ffff:127.0.0.1" or "::ffff:7f00:1"): IPv4-mapped
 * addresses, and the NAT64 prefix 64:ff9b::/96, which a translating network turns back into that IPv4 address.
 */
function mappedIpv4(address: string) {
	const carrier = /^(?:(?:0{0,4}:){0,5}:?ffff|64:ff9b::)/iu.exec(address)?.[0];
	if (!carrier) return undefined;
	const rest = address.slice(carrier.length).replace(/^:/u, "");
	const dotted = /^(\d+\.\d+\.\d+\.\d+)$/u.exec(rest)?.[1];
	if (dotted) return dotted;
	const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(rest);
	if (!hex) return undefined;
	const [high, low] = [Number.parseInt(hex[1]!, 16), Number.parseInt(hex[2]!, 16)];
	return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Connects only to addresses its own lookup accepted, so a name cannot resolve to a public address for the check and
 * to a private one for the connection.
 */
const publicOnly = new Agent({
	// Springer Nature's Fastly answers undici's HTTP/1.1 requests with a JavaScript challenge, but not HTTP/2 ones.
	allowH2: true,
	connect: {
		// Node tries a host's addresses in turn and gives each 250 ms by default. A journal's server on another
		// continent, or a busy connection, takes longer to answer, and the request then failed as a timeout.
		autoSelectFamilyAttemptTimeout: 2_000,
		lookup(hostname, options, callback) {
			lookupCallback(hostname, { all: true }, (error, addresses) => {
				if (error) return callback(error, "", 0);
				if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
					return callback(new Error("Private URL is not allowed"), "", 0);
				}
				if (options.all) return (callback as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
				callback(null, addresses[0]!.address, addresses[0]!.family);
			});
		},
	},
});

/**
 * One request over `publicOnly`, with no redirect followed. For the PDF search (@opendeved/paper-pdf), which follows
 * redirects itself and checks each address, written-out ones included, before it asks.
 */
export const publicTransport = ((input: Parameters<typeof undiciFetch>[0], init?: RequestInit) =>
	undiciFetch(input, { ...init, redirect: "manual", dispatcher: publicOnly })) as unknown as typeof fetch;

/**
 * An address from stored data or settings may only reach the public internet, never this network. A name is
 * checked once, when `publicOnly` resolves it to connect; an address written in the URL is never looked up, so it
 * is checked here.
 */
function assertPublicHttpUrl(url: URL) {
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Unsupported URL protocol");
	}

	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (hostname === "localhost" || hostname.endsWith(".local") || (isIP(hostname) && isPrivateIp(hostname))) {
		throw new Error("Private URL is not allowed");
	}
}

/** A request to a public address; every redirect is checked the same way before it is followed. */
export async function publicRequest(url: URL, init: Omit<RequestInit, "redirect" | "dispatcher">, redirects = 0): Promise<Response> {
	if (redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
	assertPublicHttpUrl(url);
	// A failed connection names its host: after a redirect it is not the host first asked.
	const response = await undiciFetch(url, { ...init, redirect: "manual", dispatcher: publicOnly }).catch((error: unknown) => {
		throw error instanceof Error ? Object.assign(error, { host: url.hostname }) : error;
	});
	if (response.status >= 300 && response.status < 400) {
		// Release the connection first: a redirect's body could otherwise hold it open until the timeout.
		await response.body?.cancel();
		const location = response.headers.get("location");
		if (!location) throw new Error("Redirect had no destination");
		return publicRequest(new URL(location, url), init, redirects + 1);
	}
	return response;
}

/** Bytes several downloads share. A download takes from it as it receives and gives back what it took if it fails. */
export type SharedByteBudget = { remaining: number };

/** A download stopped because the files sharing its budget passed it together. `available` is what it had to work with. */
export class SharedBudgetExceeded extends Error {
	constructor(readonly available: number) {
		super("The files together are too large");
	}
}

/**
 * Downloads a file from a public address, stopping at the time and size
 * limits. With `idleTimeoutMs`, a download that receives nothing for that
 * long stops too, while a slow one that keeps sending may take the full time.
 * With `shared`, the download also stops once the files together use up that budget.
 */
export async function fetchPublicFile(
	url: URL,
	{ accept, timeoutMs, idleTimeoutMs, maxBytes = Number.POSITIVE_INFINITY, shared = { remaining: Number.POSITIVE_INFINITY } }: { accept: string; timeoutMs: number; idleTimeoutMs?: number; maxBytes?: number; shared?: SharedByteBudget },
): Promise<{ data: Uint8Array; contentType: string; url: URL }> {
	const idle = new AbortController();
	let idleTimer: NodeJS.Timeout | undefined;
	const stillReceiving = () => {
		if (idleTimeoutMs === undefined) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => idle.abort(new Error("Download stalled")), idleTimeoutMs);
	};
	stillReceiving();
	try {
		return await downloadPublicFile(url, accept, { maxBytes, shared }, AbortSignal.any([AbortSignal.timeout(timeoutMs), idle.signal]), stillReceiving);
	} finally {
		clearTimeout(idleTimer);
	}
}

type SizeLimits = { maxBytes: number; shared: SharedByteBudget };

/** Why a file of `size` bytes can't be kept, if it can't. `taken` of them already came out of the shared budget. */
function sizeProblem(size: number, taken: number, { maxBytes, shared }: SizeLimits) {
	if (size > maxBytes) return new Error("File is too large");
	if (size - taken > shared.remaining) return new SharedBudgetExceeded(shared.remaining + taken);
	return null;
}

async function downloadPublicFile(
	url: URL,
	accept: string,
	limits: SizeLimits,
	signal: AbortSignal,
	stillReceiving: () => void,
): Promise<{ data: Uint8Array; contentType: string; url: URL }> {
	const response = await publicRequest(url, {
		// Some servers answer 404 to a strict Accept, EPrints repositories among them, though they serve the file to */*.
		headers: { Accept: `${accept}, */*;q=0.8`, "User-Agent": "Evidence-Library/1.0" },
		signal,
	});
	const refused = !response.ok ? new Error(`Download returned ${response.status}`) : sizeProblem(Number(response.headers?.get("content-length")) || 0, 0, limits);
	if (refused) {
		// Release the connection: an unread body holds it open.
		await response.body?.cancel().catch(() => undefined);
		throw refused;
	}
	const contentType = response.headers?.get("content-type") ?? "";
	// Where redirects ended, so a page's relative links resolve against it.
	const finalUrl = response.url ? new URL(response.url) : url;
	if (!response.body) {
		const data = new Uint8Array(await response.arrayBuffer());
		const tooLarge = sizeProblem(data.byteLength, 0, limits);
		if (tooLarge) throw tooLarge;
		limits.shared.remaining -= data.byteLength;
		return { data, contentType, url: finalUrl };
	}
	const data = await readBody(response.body, limits, signal, stillReceiving);
	return { data, contentType, url: finalUrl };
}

/** Reads a response body within the size limits, ending a waiting read when the download is stopped. */
async function readBody(
	body: NonNullable<Response["body"]>,
	limits: SizeLimits,
	signal: AbortSignal,
	stillReceiving: () => void,
) {
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = body.getReader();
	// A read already waiting ends when the download is stopped.
	const stop = () => void reader.cancel(signal.reason).catch(() => undefined);
	signal.addEventListener("abort", stop, { once: true });
	try {
		for (let part = await reader.read(); !part.done; part = await reader.read()) {
			stillReceiving();
			const tooLarge = sizeProblem(size + part.value.byteLength, size, limits);
			if (tooLarge) {
				await reader.cancel();
				throw tooLarge;
			}
			size += part.value.byteLength;
			limits.shared.remaining -= part.value.byteLength;
			chunks.push(part.value);
		}
		signal.throwIfAborted();
	} catch (error) {
		limits.shared.remaining += size;
		throw error;
	} finally {
		signal.removeEventListener("abort", stop);
	}
	const data = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return data;
}
