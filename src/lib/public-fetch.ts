import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;

const PRIVATE_IPV4_RANGES = [
	(parts: number[]) => parts[0] === 0,
	(parts: number[]) => parts[0] === 10,
	(parts: number[]) => parts[0] === 127,
	(parts: number[]) => parts[0] === 169 && parts[1] === 254,
	(parts: number[]) => parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31,
	(parts: number[]) => parts[0] === 192 && parts[1] === 168,
];

const PRIVATE_IPV6_PREFIXES = ["fc", "fd", "fe8", "fe9", "fea", "feb"];

function isPrivateIpV4(address: string) {
	const parts = address.split(".").map(Number);
	return PRIVATE_IPV4_RANGES.some((inRange) => inRange(parts));
}

function isPrivateIpV6(address: string) {
	const normalized = address.toLowerCase();
	return (
		normalized === "::1" ||
		PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix))
	);
}

function isPrivateIp(address: string) {
	const version = isIP(address);
	if (version === 4) return isPrivateIpV4(address);
	if (version === 6) return isPrivateIpV6(address);
	return true;
}

/** An address from stored data or settings may only reach the public internet, never this network. */
export async function assertPublicHttpUrl(url: URL) {
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Unsupported URL protocol");
	}

	const hostname = url.hostname.toLowerCase();
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

/**
 * Downloads a file from a public address: every hop, redirects included, must resolve to a public address, and the
 * download stops at the time and size limits.
 */
export async function fetchPublicFile(
	url: URL,
	{ accept, timeoutMs, maxBytes = Number.POSITIVE_INFINITY }: { accept: string; timeoutMs: number; maxBytes?: number },
	redirects = 0,
): Promise<{ data: Uint8Array; contentType: string }> {
	if (redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
	await assertPublicHttpUrl(url);
	const response = await fetch(url, {
		headers: { Accept: accept, "User-Agent": "Evidence-Library/1.0" },
		redirect: "manual",
		cache: "no-store",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (!location) throw new Error("Redirect had no destination");
		return fetchPublicFile(new URL(location, url), { accept, timeoutMs, maxBytes }, redirects + 1);
	}
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
