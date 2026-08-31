export const HUGEICON_SHARD_COUNT = 64;

/**
 * Keeps every icon in the same small sprite file in every build. The hash is
 * intentionally simple because it also runs in the browser.
 */
export function hugeiconShard(iconId: string): string {
	let hash = 2_166_136_261;
	for (let index = 0; index < iconId.length; index += 1) {
		hash ^= iconId.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return ((hash >>> 0) % HUGEICON_SHARD_COUNT)
		.toString(16)
		.padStart(2, "0");
}

export function hugeiconSpriteUrl(iconId: string): string {
	return `/library-icons/${hugeiconShard(iconId)}.svg#${iconId}`;
}
