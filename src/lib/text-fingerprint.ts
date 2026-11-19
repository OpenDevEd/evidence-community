/**
 * A short fingerprint of a record's text (FNV-1a, 32 bits). A translation counts only while it matches the text it came
 * from, so an edited title or abstract is translated again and an untouched one never is.
 */
export function textFingerprint(text: string) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}
