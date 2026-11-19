import { createClient } from "@supabase/supabase-js";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "@/lib/revision-aware-resource";

export type SignedFileUpload = {
	path: string;
	signedUrl: string;
	token: string;
};

export interface EvidenceFileStorage {
	createSignedUpload(path: string): Promise<SignedFileUpload>;
	downloadPrivate(path: string): Promise<Uint8Array>;
	downloadPublic(path: string): Promise<Uint8Array>;
	uploadPrivate(
		path: string,
		data: Uint8Array,
		contentType: string,
	): Promise<void>;
	uploadPublic(
		path: string,
		data: Uint8Array,
		contentType: string,
	): Promise<void>;
	publicUrl(path: string): string;
	removePrivate(paths: string[]): Promise<void>;
	removePublic(paths: string[]): Promise<void>;
}

export class EvidenceFileStorageError extends Error {
	constructor(
		operation: string,
		message: string,
		/** The object isn't there, as opposed to storage failing to answer. */
		readonly missing = false,
	) {
		super(`Storage ${operation} failed: ${message}`);
		this.name = "EvidenceFileStorageError";
	}
}

/** Supabase answers a missing object with 404, or 400 carrying `statusCode: "404"` on older servers. */
const missingObject = (error: { message: string; status?: unknown; statusCode?: unknown }) =>
	error.status === 404 || error.statusCode === "404" || /not.?found/iu.test(error.message);

type StorageFailure = { message: string; status?: number; code?: string; originalError?: unknown };

/** A network error's reasons, outermost first: `fetch failed` says little, its cause (`ECONNRESET`, a timeout) says why. */
function causeChain(error: unknown): string {
	const reasons: string[] = [];
	for (let cause = error; cause instanceof Error && reasons.length < 5; cause = cause.cause) {
		const code = (cause as { code?: unknown }).code;
		reasons.push(typeof code === "string" ? `${cause.message} [${code}]` : cause.message);
	}
	return reasons.join(" <- ");
}

/** What the storage service said, for the log: the HTTP status and its error code, the message, and why a request got no response. */
function describeStorageFailure(error: StorageFailure) {
	const cause = error.originalError === undefined ? "" : ` (${causeChain(error.originalError)})`;
	const status = error.status === undefined ? "no response" : `HTTP ${error.status}${error.code ? ` ${error.code}` : ""}`;
	return `${status}: ${error.message}${cause}`;
}

const STORAGE_WRITE_DELAYS_MS = [1_000, 4_000];

/**
 * A write the storage service can fail for a moment (no response, a lock, 429 or a 5xx) is tried again twice, so one
 * hiccup doesn't end an import of thousands of files. Anything else fails at once.
 */
async function storageWrite(operation: string, write: () => Promise<{ error: StorageFailure | null }>) {
	for (let attempt = 0; ; attempt += 1) {
		const { error } = await write();
		if (!error) return;
		// 423 is a storage lock the service asks clients to wait out.
		const transient = error.status === undefined || error.status === 423 || error.status === 429 || error.status >= 500;
		if (!transient || attempt >= STORAGE_WRITE_DELAYS_MS.length)
			throw new EvidenceFileStorageError(operation, describeStorageFailure(error));
		await new Promise((resolve) => setTimeout(resolve, STORAGE_WRITE_DELAYS_MS[attempt]));
	}
}

export function createSupabaseFileStorage(
	configuration: LibraryServerConfig["services"]["storage"],
): EvidenceFileStorage {
	const client = createClient(
		configuration.url,
		configuration.serviceRoleKey,
		{
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		},
	);

	return {
		async createSignedUpload(path) {
			const { data, error } = await client.storage
				.from(configuration.privateBucket)
				.createSignedUploadUrl(path, { upsert: true });
			if (error) {
				throw new EvidenceFileStorageError(
					"signed upload",
					error.message,
				);
			}
			return data;
		},

		async downloadPrivate(path) {
			const { data, error } = await client.storage
				.from(configuration.privateBucket)
				.download(path);
			if (error) {
				throw new EvidenceFileStorageError(
					"private download",
					error.message,
					missingObject(error),
				);
			}
			return new Uint8Array(await data.arrayBuffer());
		},

		async downloadPublic(path) {
			const { data, error } = await client.storage
				.from(configuration.publicBucket)
				.download(path);
			if (error) {
				throw new EvidenceFileStorageError(
					"public download",
					error.message,
					missingObject(error),
				);
			}
			return new Uint8Array(await data.arrayBuffer());
		},

		async uploadPrivate(path, data, contentType) {
			await storageWrite("private upload", () =>
				client.storage.from(configuration.privateBucket).upload(path, data, { cacheControl: "3600", contentType, upsert: true }),
			);
		},

		async uploadPublic(path, data, contentType) {
			await storageWrite("public upload", () =>
				client.storage.from(configuration.publicBucket).upload(path, data, { cacheControl: "60", contentType, upsert: true }),
			);
		},

		publicUrl(path) {
			return client.storage
				.from(configuration.publicBucket)
				.getPublicUrl(path).data.publicUrl;
		},

		async removePrivate(paths) {
			if (paths.length === 0) return;
			await storageWrite("private removal", () => client.storage.from(configuration.privateBucket).remove(paths));
		},

		async removePublic(paths) {
			if (paths.length === 0) return;
			await storageWrite("public removal", () => client.storage.from(configuration.publicBucket).remove(paths));
		},
	};
}

type StorageConfiguration =
	LibraryServerConfig["services"]["storage"];

function storageConfigurationsEqual(
	left: StorageConfiguration,
	right: StorageConfiguration,
) {
	return (
		left.url === right.url &&
		left.serviceRoleKey === right.serviceRoleKey &&
		left.privateBucket === right.privateBucket &&
		left.publicBucket === right.publicBucket &&
		left.maxPdfBytes === right.maxPdfBytes
	);
}

export class RevisionAwareFileStorageFactory {
	readonly #factory = new RevisionAwareResourceFactory(
		"Supabase storage",
		(configuration: StorageConfiguration) => ({
			value: createSupabaseFileStorage(configuration),
		}),
		{
			configurationEquals: storageConfigurationsEqual,
		},
	);

	get({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: StorageConfiguration;
		revision: string;
		updatedAt: string;
	}) {
		return this.#factory.get({
			configuration,
			revision,
			updatedAt,
		});
	}
}
