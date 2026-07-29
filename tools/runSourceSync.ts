import { hostname } from "node:os";

import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { createEnvironmentCredentialResolver } from "../src/lib/source-ingestion/credentials";
import { createDefaultSourceAdapterRegistry } from "../src/lib/source-ingestion/default-registry";
import {
	runActiveSourceConnections,
	runSourceConnection,
} from "../src/lib/source-ingestion/orchestrator";

const usage =
	"Usage: npm run source:sync -- [--connection <key>] [--concurrency <1-32>] [--worker-id <id>]";

type Command = {
	concurrency: number;
	sourceConnectionKey?: string;
	workerId: string;
};

function requireValue(args: string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(usage);
	return value;
}

function parseCommand(args: string[]): Command {
	let concurrency = 2;
	let sourceConnectionKey: string | undefined;
	let workerId = `${hostname()}:${process.pid}`;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--connection") {
			sourceConnectionKey = requireValue(args, index);
			index += 1;
			continue;
		}
		if (argument === "--concurrency") {
			concurrency = Number(requireValue(args, index));
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

	return { concurrency, sourceConnectionKey, workerId };
}

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const config = await loadLibraryConfig();
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);

	try {
		const options = {
			credentialResolver: createEnvironmentCredentialResolver(),
			database: databaseResource.database,
			registry: createDefaultSourceAdapterRegistry(),
			workerId: command.workerId,
		};
		const result = command.sourceConnectionKey
			? await runSourceConnection({
					...options,
					sourceConnectionKey: command.sourceConnectionKey,
				})
			: await runActiveSourceConnections({
					...options,
					concurrency: command.concurrency,
				});
		console.log(JSON.stringify(result, null, 2));
		if (
			Array.isArray(result) &&
			result.some((entry) => entry.status === "failed")
		) {
			process.exitCode = 1;
		}
	} finally {
		await databaseResource.dispose();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
