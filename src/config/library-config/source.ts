import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
	libraryConfigSchema,
	MAX_LIBRARY_CONFIG_BYTES,
	type LibraryServerConfig,
} from "./schema";
import { revisionSchema, utcTimestampSchema } from "./primitives";

const DEFAULT_DEVELOPMENT_CONFIG_PATH = "config/library.local.json";

const revisionMetadataSchema = z.looseObject({
	schemaVersion: z.literal(1),
	revision: revisionSchema,
	updatedAt: utcTimestampSchema,
});

export type LibraryConfigEnvironment = "development" | "production";

export type LibraryConfigRevision = {
	schemaVersion: 1;
	revision: string;
	updatedAt: string;
};

export type RejectedLibraryConfigRevision = {
	schemaVersion: 1 | null;
	revision: string | null;
	updatedAt: string | null;
};

export type LibraryConfigHealth = {
	state: "active" | "rejected";
	active: LibraryConfigRevision | null;
	rejected: RejectedLibraryConfigRevision | null;
};

export type LibraryConfigSourceErrorCode =
	| "CONFIG_PATH_REQUIRED"
	| "FILE_NOT_FOUND"
	| "FILE_NOT_REGULAR"
	| "FILE_TOO_LARGE"
	| "FILE_READ_FAILED"
	| "INVALID_UTF8"
	| "INVALID_JSON"
	| "INVALID_CONFIG"
	| "REVISION_REUSED"
	| "REVISION_NOT_NEWER";

type LibraryConfigSourceErrorOptions = {
	code: LibraryConfigSourceErrorCode;
	details?: readonly string[];
	revision?: RejectedLibraryConfigRevision | null;
	cause?: unknown;
};

export class LibraryConfigSourceError extends Error {
	readonly code: LibraryConfigSourceErrorCode;
	readonly details: readonly string[];
	readonly revision: RejectedLibraryConfigRevision | null;

	constructor(message: string, options: LibraryConfigSourceErrorOptions) {
		super(message, { cause: options.cause });
		this.name = "LibraryConfigSourceError";
		this.code = options.code;
		this.details = options.details ?? [];
		this.revision = options.revision ?? null;
	}
}

type ActiveLibraryConfig = {
	config: LibraryServerConfig;
	digest: string;
	revision: LibraryConfigRevision;
};

type RejectedLibraryConfig = {
	error: LibraryConfigSourceError;
	revision: RejectedLibraryConfigRevision;
};

export type LibraryConfigSourceOptions = {
	cwd?: string;
	environment?: LibraryConfigEnvironment;
	openFile?: (sourcePath: string, flags: "r") => Promise<FileHandle>;
	path?: string;
};

function currentEnvironment(): LibraryConfigEnvironment {
	return process.env.NODE_ENV === "production" ? "production" : "development";
}

function emptyRejectedRevision(): RejectedLibraryConfigRevision {
	return {
		schemaVersion: null,
		revision: null,
		updatedAt: null,
	};
}

function extractRevisionMetadata(
	value: unknown,
): RejectedLibraryConfigRevision {
	const result = revisionMetadataSchema.safeParse(value);
	if (!result.success) return emptyRejectedRevision();

	return {
		schemaVersion: result.data.schemaVersion,
		revision: result.data.revision,
		updatedAt: result.data.updatedAt,
	};
}

function toActiveRevision(config: LibraryServerConfig): LibraryConfigRevision {
	return {
		schemaVersion: config.schemaVersion,
		revision: config.revision,
		updatedAt: config.updatedAt,
	};
}

export function digestLibraryConfig(config: LibraryServerConfig) {
	const revisionContent: Record<string, unknown> = { ...config };
	delete revisionContent.updatedAt;
	return createHash("sha256")
		.update(JSON.stringify(sortJsonObjectKeys(revisionContent)))
		.digest("hex");
}

function sortJsonObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
	if (!value || typeof value !== "object") return value;

	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortJsonObjectKeys(entry)]),
	);
}

export function assertLibraryConfigRevisionAdvances(
	candidate: LibraryServerConfig,
	current: {
		revision: string | null;
		updatedAt: string | null;
	} | null,
) {
	if (
		!current?.updatedAt ||
		current.revision === candidate.revision ||
		Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt)
	) {
		return;
	}

	throw new LibraryConfigSourceError(
		"Configuration updatedAt must be newer than the active revision",
		{
			code: "REVISION_NOT_NEWER",
			details: [
				`active updatedAt: ${current.updatedAt}`,
				`candidate updatedAt: ${candidate.updatedAt}`,
			],
			revision: toActiveRevision(candidate),
		},
	);
}

function validationDetails(error: z.ZodError) {
	return error.issues.map((issue) => {
		const location = issue.path.length ? issue.path.join(".") : "manifest";
		return `${location}: ${issue.message}`;
	});
}

function normalizeSourceError(
	error: unknown,
	revision: RejectedLibraryConfigRevision = emptyRejectedRevision(),
) {
	if (error instanceof LibraryConfigSourceError) return error;

	const nodeError = error as NodeJS.ErrnoException;
	if (nodeError?.code === "ENOENT") {
		return new LibraryConfigSourceError(
			"Library configuration file was not found",
			{
				code: "FILE_NOT_FOUND",
				revision,
				cause: error,
			},
		);
	}

	return new LibraryConfigSourceError(
		"Library configuration file could not be read",
		{
			code: "FILE_READ_FAILED",
			revision,
			cause: error,
		},
	);
}

export function resolveLibraryConfigPath(
	options: LibraryConfigSourceOptions = {},
) {
	const environment = options.environment ?? currentEnvironment();
	const configuredPath =
		options.path !== undefined
			? options.path.trim()
			: process.env.LIBRARY_CONFIG_PATH?.trim();

	if (configuredPath) {
		return path.resolve(options.cwd ?? process.cwd(), configuredPath);
	}

	if (environment === "development") {
		return path.resolve(
			options.cwd ?? process.cwd(),
			DEFAULT_DEVELOPMENT_CONFIG_PATH,
		);
	}

	throw new LibraryConfigSourceError(
		"LIBRARY_CONFIG_PATH is required in production",
		{ code: "CONFIG_PATH_REQUIRED" },
	);
}

export class LibraryConfigSource {
	readonly #options: LibraryConfigSourceOptions;
	#active: ActiveLibraryConfig | null = null;
	#checkedVersion: string | null = null;
	#inFlight: Promise<LibraryServerConfig> | null = null;
	#path: string | null = null;
	#rejected: RejectedLibraryConfig | null = null;

	constructor(options: LibraryConfigSourceOptions = {}) {
		this.#options = options;
	}

	load(): Promise<LibraryServerConfig> {
		if (this.#inFlight) return this.#inFlight;

		this.#inFlight = this.#loadOnce().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}

	getHealth(): LibraryConfigHealth {
		return {
			state: this.#rejected || !this.#active ? "rejected" : "active",
			active: this.#active?.revision ?? null,
			rejected: this.#rejected?.revision ?? null,
		};
	}

	async #loadOnce(): Promise<LibraryServerConfig> {
		const environment = this.#options.environment ?? currentEnvironment();
		let sourcePath: string;

		try {
			sourcePath = resolveLibraryConfigPath(this.#options);
		} catch (error) {
			this.#checkedVersion = null;
			return this.#reject(normalizeSourceError(error), environment);
		}

		if (sourcePath !== this.#path) {
			this.#active = null;
			this.#checkedVersion = null;
			this.#path = sourcePath;
			this.#rejected = null;
		}

		let file;
		try {
			const openFile = this.#options.openFile ?? open;
			file = await openFile(/* turbopackIgnore: true */ sourcePath, "r");
		} catch (error) {
			this.#checkedVersion = null;
			return this.#reject(normalizeSourceError(error), environment);
		}

		let versionComputed = false;
		try {
			const stats = await file.stat({ bigint: true });
			if (!stats.isFile()) {
				this.#checkedVersion = null;
				return this.#reject(
					new LibraryConfigSourceError(
						"Library configuration path must reference a regular file",
						{ code: "FILE_NOT_REGULAR" },
					),
					environment,
				);
			}

			const version = `${stats.mtimeNs}:${stats.size}:${stats.ino}`;
			versionComputed = true;
			if (version === this.#checkedVersion) {
				if (this.#rejected) {
					return this.#reject(this.#rejected.error, environment);
				}
				if (this.#active) return this.#active.config;
			}

			this.#checkedVersion = version;
			if (stats.size > BigInt(MAX_LIBRARY_CONFIG_BYTES)) {
				return this.#reject(
					new LibraryConfigSourceError(
						`Library configuration exceeds ${MAX_LIBRARY_CONFIG_BYTES} bytes`,
						{ code: "FILE_TOO_LARGE" },
					),
					environment,
				);
			}

			const bytes = await file.readFile();
			if (bytes.byteLength > MAX_LIBRARY_CONFIG_BYTES) {
				return this.#reject(
					new LibraryConfigSourceError(
						`Library configuration exceeds ${MAX_LIBRARY_CONFIG_BYTES} bytes`,
						{ code: "FILE_TOO_LARGE" },
					),
					environment,
				);
			}

			let json: string;
			try {
				json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch (error) {
				return this.#reject(
					new LibraryConfigSourceError(
						"Library configuration must be valid UTF-8",
						{ code: "INVALID_UTF8", cause: error },
					),
					environment,
				);
			}

			let input: unknown;
			try {
				input = JSON.parse(json);
			} catch (error) {
				return this.#reject(
					new LibraryConfigSourceError(
						"Library configuration contains invalid JSON",
						{ code: "INVALID_JSON", cause: error },
					),
					environment,
				);
			}

			const rejectedRevision = extractRevisionMetadata(input);
			const result = libraryConfigSchema.safeParse(input);
			if (!result.success) {
				return this.#reject(
					new LibraryConfigSourceError(
						"Library configuration failed validation",
						{
							code: "INVALID_CONFIG",
							details: validationDetails(result.error),
							revision: rejectedRevision,
						},
					),
					environment,
				);
			}

			const digest = digestLibraryConfig(result.data);
			if (
				this.#active?.revision.revision === result.data.revision &&
				this.#active.digest !== digest
			) {
				return this.#reject(
					new LibraryConfigSourceError(
						"Configuration content changed without a new revision",
						{
							code: "REVISION_REUSED",
							revision: rejectedRevision,
						},
					),
					environment,
				);
			}

			if (
				this.#active?.revision.revision === result.data.revision &&
				this.#active.digest === digest
			) {
				if (
					Date.parse(result.data.updatedAt) >
					Date.parse(this.#active.revision.updatedAt)
				) {
					this.#active = {
						config: result.data,
						digest,
						revision: toActiveRevision(result.data),
					};
				}
				this.#rejected = null;
				return this.#active.config;
			}

			assertLibraryConfigRevisionAdvances(
				result.data,
				this.#active?.revision ?? null,
			);

			this.#active = {
				config: result.data,
				digest,
				revision: toActiveRevision(result.data),
			};
			this.#rejected = null;
			return result.data;
		} catch (error) {
			const sourceError = normalizeSourceError(error);
			if (!versionComputed || sourceError.code === "FILE_READ_FAILED") {
				this.#checkedVersion = null;
			}
			return this.#reject(sourceError, environment);
		} finally {
			await file.close().catch(() => undefined);
		}
	}

	#reject(
		error: LibraryConfigSourceError,
		environment: LibraryConfigEnvironment,
	): LibraryServerConfig {
		this.#rejected = {
			error,
			revision: error.revision ?? emptyRejectedRevision(),
		};

		if (environment === "production" && this.#active) {
			return this.#active.config;
		}

		throw error;
	}
}

const libraryConfigGlobal = globalThis as typeof globalThis & {
	__evidenceLibraryConfigSource?: LibraryConfigSource;
};

const defaultLibraryConfigSource =
	libraryConfigGlobal.__evidenceLibraryConfigSource ??
	new LibraryConfigSource();

libraryConfigGlobal.__evidenceLibraryConfigSource = defaultLibraryConfigSource;

export function loadLibraryConfig() {
	return defaultLibraryConfigSource.load();
}

export function getLibraryConfigHealth() {
	return defaultLibraryConfigSource.getHealth();
}

export async function validateLibraryConfigFile(sourcePath: string) {
	const source = new LibraryConfigSource({
		environment: "development",
		path: sourcePath,
	});
	return source.load();
}
