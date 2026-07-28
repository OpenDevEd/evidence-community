import path from "node:path";

import {
	activateLibraryConfig,
	rollbackLibraryConfig,
} from "../src/config/library-config/activation";
import {
	LibraryConfigSourceError,
	resolveLibraryConfigPath,
} from "../src/config/library-config/source";
import { utcTimestampSchema } from "../src/config/library-config/primitives";

const usage =
	"Usage: npm run config:activate -- <candidate-path> [target-path]\n       npm run config:activate -- --rollback [target-path] [--health-url <url> | --minimum-updated-at <timestamp>]";
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();

type ActivationCommand = {
	candidatePath: string;
	kind: "activate";
	targetPath: string;
};

type RollbackCommand = {
	healthUrl?: string;
	kind: "rollback";
	minimumUpdatedAt?: string;
	targetPath: string;
};

function resolveTargetPath(configuredPath?: string) {
	return configuredPath
		? path.resolve(invocationDirectory, configuredPath)
		: resolveLibraryConfigPath({ environment: "production" });
}

function parseCommand(args: string[]): ActivationCommand | RollbackCommand {
	const [first, ...rest] = args;
	if (!first) throw new Error(usage);

	if (first !== "--rollback") {
		if (first.startsWith("--") || rest.length > 1) {
			throw new Error(usage);
		}
		if (rest[0]?.startsWith("--")) throw new Error(usage);
		return {
			candidatePath: path.resolve(invocationDirectory, first),
			kind: "activate",
			targetPath: resolveTargetPath(rest[0]),
		};
	}

	let configuredTargetPath: string | undefined;
	let healthUrl: string | undefined;
	let minimumUpdatedAt: string | undefined;
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (argument === "--health-url") {
			healthUrl = rest[index + 1];
			if (!healthUrl) throw new Error(usage);
			index += 1;
			continue;
		}
		if (argument === "--minimum-updated-at") {
			minimumUpdatedAt = rest[index + 1];
			if (!minimumUpdatedAt) throw new Error(usage);
			minimumUpdatedAt = utcTimestampSchema.parse(minimumUpdatedAt);
			index += 1;
			continue;
		}
		if (argument.startsWith("--") || configuredTargetPath) {
			throw new Error(usage);
		}
		configuredTargetPath = argument;
	}
	if (healthUrl && minimumUpdatedAt) throw new Error(usage);

	return {
		healthUrl,
		kind: "rollback",
		minimumUpdatedAt,
		targetPath: resolveTargetPath(configuredTargetPath),
	};
}

function printSourceError(error: LibraryConfigSourceError) {
	console.error(`${error.code}: ${error.message}`);
	error.details.forEach((detail) => console.error(`- ${detail}`));
}

async function activeUpdatedAtFromHealth(healthUrl: string) {
	const url = new URL(healthUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Health URL must use HTTP or HTTPS");
	}
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Configuration health request failed with status ${response.status}`,
		);
	}
	const health = (await response.json()) as {
		active?: { updatedAt?: unknown } | null;
	};
	return utcTimestampSchema.parse(health.active?.updatedAt);
}

async function main() {
	try {
		const command = parseCommand(process.argv.slice(2));
		const result =
			command.kind === "rollback"
				? await rollbackLibraryConfig({
						minimumUpdatedAt: command.healthUrl
							? await activeUpdatedAtFromHealth(command.healthUrl)
							: command.minimumUpdatedAt,
						targetPath: command.targetPath,
					})
				: await activateLibraryConfig({
						candidatePath: command.candidatePath,
						targetPath: command.targetPath,
					});
		console.log(
			`${command.kind === "rollback" ? "Rolled back" : "Activated"} library configuration revision ${result.active.revision} at ${result.targetPath}`,
		);
		if (result.previous) {
			console.log(
				`Preserved revision ${result.previous.revision} at ${result.backupPath}`,
			);
		}
	} catch (error) {
		if (error instanceof LibraryConfigSourceError) {
			printSourceError(error);
		} else if (error instanceof Error) {
			console.error(error.message);
		} else {
			console.error(error);
		}
		process.exitCode = 1;
	}
}

void main();
