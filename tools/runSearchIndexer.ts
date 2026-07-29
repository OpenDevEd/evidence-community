import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { RevisionAwareMeilisearchFactory } from "../src/lib/meilisearch-factory";
import {
	drainSearchOutbox,
	ensureSearchIndex,
	requeueSearchOutboxDeadLetters,
	rebuildSearchIndex,
} from "../src/lib/search-index/consumer";

const usage =
	"Usage: npm run search:index -- [--rebuild] [--requeue-dead-letters] [--watch] [--max-events <1-1000000>] [--poll-ms <100-60000>] [--worker-id <id>]";

type Command = {
	maxEvents: number;
	pollMs: number;
	rebuild: boolean;
	requeueDeadLetters: boolean;
	watch: boolean;
	workerId: string;
};

function requireValue(args: string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(usage);
	return value;
}

function parseCommand(args: string[]): Command {
	let maxEvents = 10_000;
	let pollMs = 1_000;
	let rebuild = false;
	let requeueDeadLetters = false;
	let watch = false;
	let workerId = `${hostname()}:${process.pid}`;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--rebuild") {
			rebuild = true;
			continue;
		}
		if (argument === "--watch") {
			watch = true;
			continue;
		}
		if (argument === "--requeue-dead-letters") {
			requeueDeadLetters = true;
			continue;
		}
		if (argument === "--max-events") {
			maxEvents = Number(requireValue(args, index));
			index += 1;
			continue;
		}
		if (argument === "--poll-ms") {
			pollMs = Number(requireValue(args, index));
			index += 1;
			continue;
		}
		if (argument === "--worker-id") {
			workerId = requireValue(args, index);
			index += 1;
			continue;
		}
		throw new Error(usage);
	}
	if (
		!Number.isSafeInteger(pollMs) ||
		pollMs < 100 ||
		pollMs > 60_000
	) {
		throw new Error(usage);
	}
	return {
		maxEvents,
		pollMs,
		rebuild,
		requeueDeadLetters,
		watch,
		workerId,
	};
}

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const config = await loadLibraryConfig();
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	const meilisearchFactory = new RevisionAwareMeilisearchFactory();
	const service = await meilisearchFactory.get({
		configuration: config.services.search,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
	const abortController = new AbortController();
	const stop = () => abortController.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	try {
		const requeued = command.requeueDeadLetters
			? await requeueSearchOutboxDeadLetters(
					databaseResource.database,
				)
			: 0;
		if (command.rebuild) {
			const plan = await rebuildSearchIndex(
				databaseResource.database,
				service,
			);
			console.log(
				JSON.stringify({
					deleted: plan.deleted,
					indexed: plan.indexed,
					rebuild: true,
					requeued,
				}),
			);
		} else {
			await ensureSearchIndex(service);
		}

		do {
			try {
				const results = await drainSearchOutbox({
					database: databaseResource.database,
					index: service.index,
					maxEvents: command.maxEvents,
					workerId: command.workerId,
				});
				if (results.length > 0 || !command.watch) {
					console.log(
						JSON.stringify({
							processed: results.reduce(
								(total, result) =>
									total +
									result.eventIds.length,
								0,
							),
							rebuild: false,
							requeued,
						}),
					);
				}
			} catch (error) {
				console.error(
					error instanceof Error
						? error.message
						: error,
				);
				if (!command.watch) throw error;
			}
			if (command.watch && !abortController.signal.aborted) {
				try {
					await delay(command.pollMs, undefined, {
						signal: abortController.signal,
					});
				} catch {
					// The process was asked to stop.
				}
			}
		} while (command.watch && !abortController.signal.aborted);
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		await databaseResource.dispose();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
