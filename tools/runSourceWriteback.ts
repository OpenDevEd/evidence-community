import { hostname } from "node:os";

import { openLibraryDatabaseProcess } from "../src/config/library-config/process";
import { loadLibraryConfig } from "../src/config/library-config/source";
import { reconcileConfiguredSources } from "../src/lib/source-ingestion/configuration";
import { parseSourceWritebackCommand } from "../src/lib/source-writeback/command";
import type { SourceWritebackProcessResult } from "../src/lib/source-writeback/consumer";
import { isSourceWritebackEnabled } from "../src/lib/source-writeback/policy";
import { createSourceWritebackRuntime } from "../src/lib/source-writeback/runtime";
import { runSourceWritebackWorker } from "../src/lib/source-writeback/worker";

function errorMessage(error: unknown) {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

function sweepFailed(results: SourceWritebackProcessResult[]) {
	return results.some((result) =>
		["dead-lettered", "lease-lost", "retrying"].includes(result.status),
	);
}

async function main() {
	const defaultWorkerId =
		process.env.SOURCE_WRITEBACK_WORKER_ID?.trim() ||
		`${hostname()}:${process.pid}`;
	const command = parseSourceWritebackCommand(
		process.argv.slice(2),
		defaultWorkerId,
	);
	const runtimeProcess = await openLibraryDatabaseProcess("source-writeback");
	const { abortController, config, databaseResource } = runtimeProcess;
	try {
		await reconcileConfiguredSources(
			databaseResource.database,
			config.sources,
		);
		const runtime = createSourceWritebackRuntime(config);
		const result = await runSourceWritebackWorker({
			credentialResolver: runtime.credentialResolver,
			database: databaseResource.database,
			maxJobsPerSweep: command.maxJobsPerSweep,
			onError: (error) => console.error(errorMessage(error)),
			onSweep: (sweep) => console.log(JSON.stringify(sweep, null, 2)),
			pollMs: command.pollMs,
			registry: runtime.registry,
			signal: abortController.signal,
			sourceWritebackEnabled: async (sourceConnectionKey) => {
				try {
					return isSourceWritebackEnabled(
						await loadLibraryConfig(),
						sourceConnectionKey,
					);
				} catch (error) {
					console.error(
						`Could not read the writeback configuration; deferring the job: ${errorMessage(error)}`,
					);
					return false;
				}
			},
			watch: command.watch,
			workerId: command.workerId,
		});
		if (
			!command.watch &&
			result.lastSweep &&
			sweepFailed(result.lastSweep)
		) {
			process.exitCode = 1;
		}
	} finally {
		await runtimeProcess.close();
	}
}

main().catch((error) => {
	console.error(errorMessage(error));
	process.exitCode = 1;
});
