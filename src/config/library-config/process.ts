import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { createPostgresDatabaseResource } from "../../db/postgres";
import { loadLibraryConfig, resolveLibraryConfigPath } from "./source";

export function watchLibraryConfigChanges({
	onChange,
	targetPath = resolveLibraryConfigPath({ environment: "production" }),
}: {
	onChange: () => void;
	targetPath?: string;
}): FSWatcher {
	const resolvedTargetPath = path.resolve(targetPath);
	const targetName = path.basename(resolvedTargetPath);
	let notified = false;
	const watcher = watch(
		path.dirname(resolvedTargetPath),
		{ persistent: false },
		(_eventType, filename) => {
			if (notified || filename?.toString() !== targetName) return;
			notified = true;
			watcher.close();
			onChange();
		},
	);
	return watcher;
}

export async function openLibraryConfigProcess() {
	const abortController = new AbortController();
	const watcher = watchLibraryConfigChanges({
		onChange: () => abortController.abort(),
	});
	let signalCount = 0;
	const stop = () => {
		signalCount += 1;
		if (signalCount === 1) abortController.abort();
		else process.exit(130);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	try {
		const config = await loadLibraryConfig();
		return {
			abortController,
			config,
			close() {
				watcher.close();
				process.off("SIGINT", stop);
				process.off("SIGTERM", stop);
			},
		};
	} catch (error) {
		watcher.close();
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		throw error;
	}
}

export async function openLibraryDatabaseProcess(options: { maxConnections?: number } = {}) {
	const configProcess = await openLibraryConfigProcess();
	const databaseResource = createPostgresDatabaseResource(
		configProcess.config.services.database.url,
		options.maxConnections,
	);
	return {
		...configProcess,
		databaseResource,
		async close() {
			configProcess.close();
			await databaseResource.dispose();
		},
	};
}
