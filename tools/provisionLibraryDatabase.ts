import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { reconcileLibraryDatabase } from "../src/lib/deployment/provision-library-database";

function parseCommandLine() {
	const { values } = parseArgs({
		allowPositionals: false,
		options: {
			"admin-url": { type: "string" },
			database: { type: "string" },
			password: { type: "string" },
			"runtime-host": { type: "string" },
			user: { type: "string" },
		},
		strict: true,
	});
	if (
		!values["admin-url"] ||
		!values.database ||
		!values.password ||
		!values["runtime-host"] ||
		!values.user
	) {
		throw new Error(
			"Usage: npm run database:provision -- --admin-url <url> --database <name> --user <name> --password <password> --runtime-host <host[:port]>",
		);
	}
	return {
		adminUrl: values["admin-url"],
		databaseName: values.database,
		loginName: values.user,
		password: values.password,
		runtimeHost: values["runtime-host"],
	};
}

async function main() {
	const result = await reconcileLibraryDatabase(parseCommandLine());
	console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
