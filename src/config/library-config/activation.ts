import { randomUUID } from "node:crypto";
import {
	open,
	stat,
	unlink,
} from "node:fs/promises";
import path from "node:path";

import {
	removeAtomicTemporaryFiles,
	replaceFileAtomically,
} from "@/lib/atomic-file";

import {
	libraryConfigSchema,
	MAX_LIBRARY_CONFIG_BYTES,
	type LibraryServerConfig,
} from "./schema";
import {
	assertLibraryConfigRevisionAdvances,
	digestLibraryConfig,
	LibraryConfigSourceError,
	validateLibraryConfigFile,
} from "./source";
import { utcTimestampSchema } from "./primitives";

export type ActivateLibraryConfigOptions = {
	backupPath?: string;
	candidatePath: string;
	targetPath: string;
};

export type ActivateLibraryConfigResult = {
	active: LibraryServerConfig;
	backupPath: string;
	previous: LibraryServerConfig | null;
	targetPath: string;
};

export type RollbackLibraryConfigOptions = {
	backupPath?: string;
	minimumUpdatedAt?: string;
	targetPath: string;
};

type ExistingLibraryConfig = {
	config: LibraryServerConfig | null;
	mode: number | null;
	updatedAt: string | null;
};

const rejectedManifestCodes = new Set([
	"FILE_TOO_LARGE",
	"INVALID_CONFIG",
	"INVALID_JSON",
	"INVALID_UTF8",
]);

async function existingFileMode(filePath: string) {
	try {
		return (await stat(filePath)).mode & 0o777;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function serializeConfig(config: LibraryServerConfig) {
	const serialized = `${JSON.stringify(config, null, "\t")}\n`;
	if (Buffer.byteLength(serialized) > MAX_LIBRARY_CONFIG_BYTES) {
		throw new LibraryConfigSourceError(
			`Normalized library configuration exceeds ${MAX_LIBRARY_CONFIG_BYTES} bytes`,
			{ code: "FILE_TOO_LARGE" },
		);
	}
	return serialized;
}

async function withActivationLock<T>(
	targetPath: string,
	backupPath: string,
	operation: () => Promise<T>,
) {
	const lockPath = `${targetPath}.activation.lock`;
	let handle;

	try {
		handle = await open(lockPath, "wx", 0o600);
		await handle.chmod(0o600);
		await handle.writeFile(
			JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
		);
		await handle.sync();
	} catch (error) {
		await handle?.close().catch(() => undefined);
		if (handle) await unlink(lockPath).catch(() => undefined);
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(
				`Another library configuration operation holds ${lockPath}`,
				{ cause: error },
			);
		}
		throw error;
	}

	try {
		await Promise.all([
			removeAtomicTemporaryFiles(targetPath),
			removeAtomicTemporaryFiles(backupPath),
		]);
		return await operation();
	} finally {
		await handle.close().catch(() => undefined);
		await unlink(lockPath).catch(() => undefined);
	}
}

async function inspectExistingConfig(
	targetPath: string,
): Promise<ExistingLibraryConfig> {
	const mode = await existingFileMode(targetPath);
	if (mode === null) {
		return { config: null, mode: null, updatedAt: null };
	}

	try {
		const config = await validateLibraryConfigFile(targetPath);
		return { config, mode, updatedAt: config.updatedAt };
	} catch (error) {
		if (
			!(error instanceof LibraryConfigSourceError) ||
			!rejectedManifestCodes.has(error.code)
		) {
			throw error;
		}

		return {
			config: null,
			mode,
			updatedAt: error.revision?.updatedAt ?? null,
		};
	}
}

async function activateValidatedConfig({
	active,
	backupPath,
	candidateMode,
	existing,
	publishBackupAfterTarget = false,
	targetPath,
}: {
	active: LibraryServerConfig;
	backupPath: string;
	candidateMode: number | null;
	existing: ExistingLibraryConfig;
	publishBackupAfterTarget?: boolean;
	targetPath: string;
}): Promise<ActivateLibraryConfigResult> {
	const activeContent = serializeConfig(active);
	const previousContent = existing.config
		? serializeConfig(existing.config)
		: null;
	const publishBackup = async () => {
		if (!previousContent) return;
		await replaceFileAtomically({
			content: previousContent,
			mode:
				(await existingFileMode(backupPath)) ??
				existing.mode ??
				candidateMode ??
				0o640,
			targetPath: backupPath,
		});
	};

	if (!publishBackupAfterTarget) await publishBackup();

	await replaceFileAtomically({
		content: activeContent,
		mode: existing.mode ?? candidateMode ?? 0o640,
		targetPath,
	});
	if (publishBackupAfterTarget) await publishBackup();

	return {
		active,
		backupPath,
		previous: existing.config,
		targetPath,
	};
}

function nextRollbackUpdatedAt(...timestamps: Array<string | null>) {
	const milliseconds = Math.max(
		Date.now(),
		...timestamps.map((timestamp) =>
			timestamp ? Date.parse(timestamp) + 1 : 0,
		),
	);
	return new Date(milliseconds).toISOString();
}

function nextRollbackRevision(sourceRevision: string) {
	const suffix = `-rollback-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	return `${sourceRevision.slice(0, 64 - suffix.length)}${suffix}`;
}

export async function activateLibraryConfig({
	backupPath: configuredBackupPath,
	candidatePath: configuredCandidatePath,
	targetPath: configuredTargetPath,
}: ActivateLibraryConfigOptions): Promise<ActivateLibraryConfigResult> {
	const candidatePath = path.resolve(configuredCandidatePath);
	const targetPath = path.resolve(configuredTargetPath);
	const backupPath = path.resolve(
		configuredBackupPath ?? `${targetPath}.previous`,
	);
	if (backupPath === targetPath) {
		throw new Error("Rollback path must differ from the active configuration path");
	}
	return withActivationLock(targetPath, backupPath, async () => {
		const active = await validateLibraryConfigFile(candidatePath);
		const existing = await inspectExistingConfig(targetPath);
		const candidateMode = await existingFileMode(candidatePath);

		if (existing.config?.revision === active.revision) {
			if (
				digestLibraryConfig(existing.config) !==
				digestLibraryConfig(active)
			) {
				throw new LibraryConfigSourceError(
					"Configuration content changed without a new revision",
					{
						code: "REVISION_REUSED",
						revision: {
							revision: active.revision,
							schemaVersion: active.schemaVersion,
							updatedAt: active.updatedAt,
						},
					},
				);
			}

			return {
				active: existing.config,
				backupPath,
				previous: null,
				targetPath,
			};
		}

		assertLibraryConfigRevisionAdvances(active, {
			revision: existing.config?.revision ?? null,
			updatedAt: existing.updatedAt,
		});

		return activateValidatedConfig({
			active,
			backupPath,
			candidateMode,
			existing,
			targetPath,
		});
	});
}

export async function rollbackLibraryConfig({
	backupPath,
	minimumUpdatedAt,
	targetPath,
}: RollbackLibraryConfigOptions) {
	const resolvedTargetPath = path.resolve(targetPath);
	const resolvedBackupPath = path.resolve(
		backupPath ?? `${resolvedTargetPath}.previous`,
	);
	if (resolvedBackupPath === resolvedTargetPath) {
		throw new Error("Rollback path must differ from the active configuration path");
	}
	const validatedMinimumUpdatedAt = minimumUpdatedAt
		? utcTimestampSchema.parse(minimumUpdatedAt)
		: null;

	return withActivationLock(
		resolvedTargetPath,
		resolvedBackupPath,
		async () => {
			const [backup, existing, backupMode] = await Promise.all([
				validateLibraryConfigFile(resolvedBackupPath),
				inspectExistingConfig(resolvedTargetPath),
				existingFileMode(resolvedBackupPath),
			]);
			if (!existing.config && !validatedMinimumUpdatedAt) {
				throw new Error(
					"minimumUpdatedAt is required to roll back while the active configuration file is invalid; use the active.updatedAt value from /api/library-config/health",
				);
			}
			const active = libraryConfigSchema.parse({
				...backup,
				revision: nextRollbackRevision(backup.revision),
				updatedAt: nextRollbackUpdatedAt(
					backup.updatedAt,
					existing.updatedAt,
					validatedMinimumUpdatedAt,
				),
			});

			return activateValidatedConfig({
				active,
				backupPath: resolvedBackupPath,
				candidateMode: backupMode,
				existing,
				publishBackupAfterTarget: true,
				targetPath: resolvedTargetPath,
			});
		},
	);
}
