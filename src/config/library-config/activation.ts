import { createHash, randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
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

export type InitializeLibraryConfigOptions = {
	backupPath?: string;
	seedPath: string;
	targetPath: string;
};

export type RestorePreviousLibraryConfigOptions = {
	backupPath?: string;
	revision: string;
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
const ACTIVATION_LOCK_STALE_MS = 30_000;
const SEED_FINGERPRINT = /^[a-f0-9]{64}$/u;

async function existingFileMode(filePath: string) {
	try {
		return (await stat(filePath)).mode & 0o777;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function deploymentSeedFingerprint(config: LibraryServerConfig) {
	return createHash("sha256")
		.update(digestLibraryConfig(config))
		.update("\0")
		.update(config.updatedAt)
		.digest("hex");
}

async function readDeploymentSeedFingerprint(seedStatePath: string) {
	try {
		const fingerprint = (await readFile(seedStatePath, "utf8")).trim();
		if (!SEED_FINGERPRINT.test(fingerprint)) {
			throw new Error(`Invalid deployment seed state at ${seedStatePath}`);
		}
		return fingerprint;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeDeploymentSeedFingerprint(
	seedStatePath: string,
	fingerprint: string,
) {
	await replaceFileAtomically({
		content: `${fingerprint}\n`,
		mode: (await existingFileMode(seedStatePath)) ?? 0o640,
		targetPath: seedStatePath,
	});
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
	waitMs = 0,
	preservedTemporaryPath?: string,
) {
	const lockPath = `${targetPath}.activation.lock`;
	const handle = await acquireActivationLock(lockPath, waitMs);

	try {
		await Promise.all([
			removeAtomicTemporaryFiles(targetPath, preservedTemporaryPath),
			removeAtomicTemporaryFiles(backupPath),
		]);
		return await operation();
	} finally {
		await handle.close().catch(() => undefined);
		await unlink(lockPath).catch(() => undefined);
	}
}

async function createActivationLock(lockPath: string) {
	const handle = await open(lockPath, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(
			JSON.stringify({
				pid: process.pid,
				startedAt: new Date().toISOString(),
			}),
		);
		await handle.sync();
		return handle;
	} catch (error) {
		await handle.close().catch(() => undefined);
		await unlink(lockPath).catch(() => undefined);
		throw error;
	}
}

async function acquireActivationLock(lockPath: string, waitMs: number) {
	const deadline = Date.now() + waitMs;
	while (true) {
		try {
			return await createActivationLock(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await removeStaleActivationLock(lockPath)) continue;
			if (Date.now() >= deadline) {
				throw new Error(
					`Another library configuration operation holds ${lockPath}`,
					{ cause: error },
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
}

async function removeStaleActivationLock(lockPath: string) {
	try {
		const lock = await stat(lockPath);
		if (Date.now() - lock.mtimeMs <= ACTIVATION_LOCK_STALE_MS) return false;
		await unlink(lockPath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
}

export async function initializeLibraryConfig({
	backupPath: configuredBackupPath,
	seedPath: configuredSeedPath,
	targetPath: configuredTargetPath,
}: InitializeLibraryConfigOptions): Promise<ActivateLibraryConfigResult> {
	const seedPath = path.resolve(
		/* turbopackIgnore: true */ configuredSeedPath,
	);
	const { backupPath, targetPath } = resolveActivationPaths(
		configuredTargetPath,
		configuredBackupPath,
	);
	const seedStatePath = `${targetPath}.deployment-seed.sha256`;

	return withActivationLock(
		targetPath,
		backupPath,
		async () => {
			await removeAtomicTemporaryFiles(seedStatePath);
			const [seed, existing, seedMode, recordedSeedFingerprint] =
				await Promise.all([
				validateLibraryConfigFile(seedPath),
				inspectExistingConfig(targetPath),
				existingFileMode(seedPath),
				readDeploymentSeedFingerprint(seedStatePath),
			]);
			const seedFingerprint = deploymentSeedFingerprint(seed);
			const activeMatchesSeed =
				existing.config !== null &&
				deploymentSeedFingerprint(existing.config) === seedFingerprint;

			// The seed state distinguishes a worker restart from a new platform
			// deployment. A restart keeps a newer live activation. A changed seed
			// is authoritative even when managed values changed under the same
			// owner revision, such as an address or credential update.
			if (
				existing.config &&
				(recordedSeedFingerprint === seedFingerprint || activeMatchesSeed)
			) {
				if (recordedSeedFingerprint !== seedFingerprint) {
					await writeDeploymentSeedFingerprint(
						seedStatePath,
						seedFingerprint,
					);
				}
				return {
					active: existing.config,
					backupPath,
					previous: null,
					targetPath,
				};
			}

			const result = await activateValidatedConfig({
				active: seed,
				backupPath,
				candidateMode: seedMode,
				existing,
				targetPath,
			});
			await writeDeploymentSeedFingerprint(
				seedStatePath,
				seedFingerprint,
			);
			return result;
		},
		5_000,
	);
}

function resolveActivationPaths(targetPath: string, backupPath?: string) {
	const resolvedTargetPath = path.resolve(
		/* turbopackIgnore: true */ targetPath,
	);
	const resolvedBackupPath = path.resolve(
		/* turbopackIgnore: true */ backupPath ??
			`${resolvedTargetPath}.previous`,
	);
	if (resolvedBackupPath === resolvedTargetPath) {
		throw new Error(
			"Rollback path must differ from the active configuration path",
		);
	}
	return { backupPath: resolvedBackupPath, targetPath: resolvedTargetPath };
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
	const candidatePath = path.resolve(
		/* turbopackIgnore: true */ configuredCandidatePath,
	);
	const { backupPath, targetPath } = resolveActivationPaths(
		configuredTargetPath,
		configuredBackupPath,
	);
	return withActivationLock(
		targetPath,
		backupPath,
		async () => {
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
		},
		0,
		candidatePath,
	);
}

export async function rollbackLibraryConfig({
	backupPath,
	minimumUpdatedAt,
	targetPath,
}: RollbackLibraryConfigOptions) {
	const { backupPath: resolvedBackupPath, targetPath: resolvedTargetPath } =
		resolveActivationPaths(targetPath, backupPath);
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

export async function restorePreviousLibraryConfig({
	backupPath,
	revision,
	targetPath,
}: RestorePreviousLibraryConfigOptions) {
	const { backupPath: resolvedBackupPath, targetPath: resolvedTargetPath } =
		resolveActivationPaths(targetPath, backupPath);
	const requestedRevision = revision.trim();
	if (!requestedRevision) throw new Error("Previous revision is required");

	return withActivationLock(
		resolvedTargetPath,
		resolvedBackupPath,
		async () => {
			const existing = await inspectExistingConfig(resolvedTargetPath);
			if (existing.config?.revision === requestedRevision) {
				return {
					active: existing.config,
					backupPath: resolvedBackupPath,
					previous: null,
					targetPath: resolvedTargetPath,
				};
			}
			const [backup, backupMode] = await Promise.all([
				validateLibraryConfigFile(resolvedBackupPath),
				existingFileMode(resolvedBackupPath),
			]);
			if (backup.revision !== requestedRevision) {
				throw new Error(
					`The preserved configuration is revision ${backup.revision}, not ${requestedRevision}`,
				);
			}
			const active = libraryConfigSchema.parse({
				...backup,
				updatedAt: nextRollbackUpdatedAt(
					backup.updatedAt,
					existing.updatedAt,
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
