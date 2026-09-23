import "server-only";

import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";

const MAX_REDIRECTS = 5;

const PRIVATE_IPV4_RANGES = [
	(parts: number[]) => parts[0] === 0,
	(parts: number[]) => parts[0] === 10,
	(parts: number[]) => parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127,
	(parts: number[]) => parts[0] === 127,
	(parts: number[]) => parts[0] === 169 && parts[1] === 254,
	(parts: number[]) => parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31,
	(parts: number[]) => parts[0] === 192 && parts[1] === 168,
	(parts: number[]) => parts[0] === 198 && (parts[1] === 18 || parts[1] === 19),
	(parts: number[]) => parts[0]! >= 224,
];

const PRIVATE_IPV6_PREFIXES = ["fc", "fd", "fe8", "fe9", "fea", "feb", "ff"];

function isPrivateIpV4(address: string) {
	const parts = address.split(".").map(Number);
	return PRIVATE_IPV4_RANGES.some((inRange) => inRange(parts));
}

function isPrivateIpV6(address: string) {
	const normalized = address.toLowerCase();
	// An IPv4 address written as IPv6 ("::ffff:127.0.0.1") is that IPv4 address; the hex form is refused outright.
	if (normalized.startsWith("::ffff:")) {
		const mapped = normalized.slice("::ffff:".length);
		return isIP(mapped) === 4 ? isPrivateIpV4(mapped) : true;
	}
	return normalized === "::" || normalized === "::1" || PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Whether an address is outside the public internet: private, loopback, link-local, shared, reserved or multicast. */
export function isPrivateIp(address: string) {
	const version = isIP(address);
	if (version === 4) return isPrivateIpV4(address);
	if (version === 6) return isPrivateIpV6(address);
	return true;
}

/**
 * Connects only to addresses its own lookup accepted, so a name cannot resolve to a public address for the check and
 * to a private one for the connection.
 */
const publicOnly = new Agent({
	connect: {
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

/** An address from stored data or settings may only reach the public internet, never this network. */
export async function assertPublicHttpUrl(url: URL) {
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Unsupported URL protocol");
	}

	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (hostname === "localhost" || hostname.endsWith(".local")) {
		throw new Error("Private URL is not allowed");
	}

	const addresses = await lookup(hostname, { all: true });
	if (
		!addresses.length ||
		addresses.some(({ address }) => isPrivateIp(address))
	) {
		throw new Error("Private URL is not allowed");
	}
}

/** A request to a public address; every redirect is checked the same way before it is followed. */
export async function publicRequest(url: URL, init: Omit<RequestInit, "redirect" | "dispatcher">, redirects = 0): Promise<Response> {
	if (redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
	await assertPublicHttpUrl(url);
	const response = await undiciFetch(url, { ...init, redirect: "manual", dispatcher: publicOnly });
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (!location) throw new Error("Redirect had no destination");
		return publicRequest(new URL(location, url), init, redirects + 1);
	}
	return response;
}

/** Downloads a file from a public address, stopping at the time and size limits. */
export async function fetchPublicFile(
	url: URL,
	{ accept, timeoutMs, maxBytes = Number.POSITIVE_INFINITY }: { accept: string; timeoutMs: number; maxBytes?: number },
): Promise<{ data: Uint8Array; contentType: string }> {
	const response = await publicRequest(url, {
		headers: { Accept: accept, "User-Agent": "Evidence-Library/1.0" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`Download returned ${response.status}`);
	if (Number(response.headers?.get("content-length")) > maxBytes) throw new Error("File is too large");
	const contentType = response.headers?.get("content-type") ?? "";
	if (!response.body) {
		const data = new Uint8Array(await response.arrayBuffer());
		if (data.byteLength > maxBytes) throw new Error("File is too large");
		return { data, contentType };
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = response.body.getReader();
	for (let part = await reader.read(); !part.done; part = await reader.read()) {
		size += part.value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw new Error("File is too large");
		}
		chunks.push(part.value);
	}
	const data = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { data, contentType };
}
