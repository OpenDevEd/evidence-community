import { randomBytes } from "node:crypto";

export const CANONICAL_RECORD_KEY_ALPHABET =
	"23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
export const CANONICAL_RECORD_KEY_LENGTH = 8;
export const CANONICAL_RECORD_KEY_SQL_PATTERN =
	`^[${CANONICAL_RECORD_KEY_ALPHABET}]{${CANONICAL_RECORD_KEY_LENGTH}}$`;
export const SOURCE_CONNECTION_KEY_SQL_PATTERN =
	"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
export const CANONICAL_RECORD_KEY_PATTERN = new RegExp(
	CANONICAL_RECORD_KEY_SQL_PATTERN,
);
export const SOURCE_CONNECTION_KEY_PATTERN = new RegExp(
	SOURCE_CONNECTION_KEY_SQL_PATTERN,
);

export function isCanonicalRecordKey(value: string): boolean {
	return CANONICAL_RECORD_KEY_PATTERN.test(value);
}

export function isSourceConnectionKey(value: string): boolean {
	return (
		value.length <= 64 &&
		value.length >= 1 &&
		SOURCE_CONNECTION_KEY_PATTERN.test(value)
	);
}

export function adoptableCanonicalRecordKey(
	sourceRecordKey: string,
): string | null {
	return isCanonicalRecordKey(sourceRecordKey) ? sourceRecordKey : null;
}

export function generateCanonicalRecordKey(): string {
	const alphabet = CANONICAL_RECORD_KEY_ALPHABET;
	const output: string[] = [];

	while (output.length < CANONICAL_RECORD_KEY_LENGTH) {
		for (const byte of randomBytes(CANONICAL_RECORD_KEY_LENGTH)) {
			const unbiasedLimit = 256 - (256 % alphabet.length);
			if (byte >= unbiasedLimit) {
				continue;
			}

			output.push(alphabet[byte % alphabet.length]!);
			if (output.length === CANONICAL_RECORD_KEY_LENGTH) {
				break;
			}
		}
	}

	return output.join("");
}
