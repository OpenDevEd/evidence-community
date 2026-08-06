import { hostname } from "node:os";

import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { parseSourceWritebackCommand } from "../src/lib/source-writeback/command";
import type { SourceWritebackProcessResult } from "../src/lib/source-writeback/consumer";
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
	const config = await loadLibraryConfig();
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	const abortController = new AbortController();
	let signalCount = 0;
	const stop = () => {
		signalCount += 1;
		if (signalCount === 1) {
			abortController.abort();
			return;
		}
		process.exit(130);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);

	try {
		const runtime = createSourceWritebackRuntime();
		const result = await runSourceWritebackWorker({
			credentialResolver: runtime.credentialResolver,
			database: databaseResource.database,
			maxJobsPerSweep: command.maxJobsPerSweep,
			onError: (error) => console.error(errorMessage(error)),
			onSweep: (sweep) => console.log(JSON.stringify(sweep, null, 2)),
			pollMs: command.pollMs,
			registry: runtime.registry,
			signal: abortController.signal,
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
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		await databaseResource.dispose();
	}
}

main().catch((error) => {
	console.error(errorMessage(error));
	process.exitCode = 1;
});
