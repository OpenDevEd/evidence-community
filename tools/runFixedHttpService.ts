import { once } from "node:events";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function listenForFixedHttpService(input: {
	listeningMessage: (port: number) => string;
	port: number;
	server: Server;
	shutdownErrorMessage: string;
}) {
	const stop = () => {
		input.server.close((error) => {
			if (error) {
				console.error(input.shutdownErrorMessage);
				process.exitCode = 1;
			}
		});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	input.server.listen(input.port, "0.0.0.0");
	await once(input.server, "listening");
	console.log(input.listeningMessage(input.port));
}

export function runFixedHttpServiceMain(input: {
	formatError: (error: unknown) => string;
	importMetaUrl: string;
	main: () => Promise<void>;
}) {
	const entrypoint = process.argv[1]
		? pathToFileURL(resolve(process.argv[1])).href
		: undefined;
	if (entrypoint !== input.importMetaUrl) return;
	input.main().catch((error: unknown) => {
		console.error(input.formatError(error));
		process.exitCode = 1;
	});
}
