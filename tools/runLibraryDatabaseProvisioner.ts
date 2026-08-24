import { once } from "node:events";

import {
	parseInternalPostgresHost,
	parsePostgresAdminUrl,
} from "../src/lib/deployment/library-database";
import { createLibraryDatabaseProvisionerServer } from "../src/lib/deployment/library-database-provisioner-http";
import { reconcileOpenScholarLibraryDatabase } from "../src/lib/deployment/provision-library-database";

function readRequiredEnvironment(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function readPort(value = "3000") {
	const port = Number(value);
	if (!Number.isInteger(port)) {
		throw new Error("PORT must be an integer between 1 and 65535.");
	}
	if (port < 1) {
		throw new Error("PORT must be an integer between 1 and 65535.");
	}
	if (port > 65_535) {
		throw new Error("PORT must be an integer between 1 and 65535.");
	}
	return port;
}

async function main() {
	const adminUrl = readRequiredEnvironment(
		"EVIDENCE_LIBRARY_ADMIN_DATABASE_URL",
	);
	const runtimeHost = readRequiredEnvironment(
		"EVIDENCE_LIBRARY_DATABASE_RUNTIME_HOST",
	);
	const token = readRequiredEnvironment(
		"EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN",
	);
	parsePostgresAdminUrl(adminUrl);
	parseInternalPostgresHost(runtimeHost);

	const server = createLibraryDatabaseProvisionerServer({
		onError: (error) =>
			console.error("Database reconciliation failed.", error),
		reconcile: ({ libraryId, password }) =>
			reconcileOpenScholarLibraryDatabase({
				adminUrl,
				libraryId,
				password,
				runtimeHost,
			}),
		token,
	});
	const stop = () => {
		server.close((error) => {
			if (error) {
				console.error("Database provisioner shutdown failed.", error);
				process.exitCode = 1;
			}
		});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	server.listen(readPort(process.env.PORT), "0.0.0.0");
	await once(server, "listening");
	const address = server.address();
	const port =
		address && typeof address !== "string"
			? address.port
			: readPort(process.env.PORT);
	console.log(`Library database provisioner is listening on port ${port}.`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
