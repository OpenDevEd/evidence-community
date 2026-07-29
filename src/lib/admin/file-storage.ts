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
	constructor(operation: string, message: string) {
		super(`Storage ${operation} failed: ${message}`);
		this.name = "EvidenceFileStorageError";
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
				);
			}
			return new Uint8Array(await data.arrayBuffer());
		},

		async uploadPrivate(path, data, contentType) {
			const { error } = await client.storage
				.from(configuration.privateBucket)
				.upload(path, data, {
					cacheControl: "3600",
					contentType,
					upsert: true,
				});
			if (error) {
				throw new EvidenceFileStorageError(
					"private upload",
					error.message,
				);
			}
		},

		async uploadPublic(path, data, contentType) {
			const { error } = await client.storage
				.from(configuration.publicBucket)
				.upload(path, data, {
					cacheControl: "60",
					contentType,
					upsert: true,
				});
			if (error) {
				throw new EvidenceFileStorageError(
					"public upload",
					error.message,
				);
			}
		},

		publicUrl(path) {
			return client.storage
				.from(configuration.publicBucket)
				.getPublicUrl(path).data.publicUrl;
		},

		async removePrivate(paths) {
			if (paths.length === 0) return;
			const { error } = await client.storage
				.from(configuration.privateBucket)
				.remove(paths);
			if (error) {
				throw new EvidenceFileStorageError(
					"private removal",
					error.message,
				);
			}
		},

		async removePublic(paths) {
			if (paths.length === 0) return;
			const { error } = await client.storage
				.from(configuration.publicBucket)
				.remove(paths);
			if (error) {
				throw new EvidenceFileStorageError(
					"public removal",
					error.message,
				);
			}
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
