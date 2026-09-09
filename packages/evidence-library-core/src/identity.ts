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
		for (const byte of crypto.getRandomValues(new Uint8Array(CANONICAL_RECORD_KEY_LENGTH))) {
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

export type CanonicalKeyReservation = {
	findExistingKey: () => Promise<string | null>;
	tryReserveKey: (candidate: string) => Promise<boolean>;
	generateKey?: () => string;
	sourceRecordKey?: string;
};

export async function reserveCanonicalRecordKey({
	findExistingKey,
	tryReserveKey,
	generateKey = generateCanonicalRecordKey,
	sourceRecordKey,
}: CanonicalKeyReservation): Promise<string> {
	const validateStoredKey = (key: string) => {
		if (!isCanonicalRecordKey(key)) {
			throw new Error(`Stored canonical record key is invalid: ${key}`);
		}
		return key;
	};

	const existingKey = await findExistingKey();
	if (existingKey) {
		return validateStoredKey(existingKey);
	}

	const adoptableKey = sourceRecordKey
		? adoptableCanonicalRecordKey(sourceRecordKey)
		: null;
	let shouldTryAdoption = adoptableKey !== null;

	for (;;) {
		const candidate = shouldTryAdoption
			? adoptableKey
			: generateKey();
		shouldTryAdoption = false;

		if (!candidate || !isCanonicalRecordKey(candidate)) {
			throw new Error(
				`Canonical key generator returned an invalid key: ${candidate}`,
			);
		}

		if (await tryReserveKey(candidate)) {
			return candidate;
		}

		const concurrentlyReservedKey = await findExistingKey();
		if (concurrentlyReservedKey) {
			return validateStoredKey(concurrentlyReservedKey);
		}
	}
}
