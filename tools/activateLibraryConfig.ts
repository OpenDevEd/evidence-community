import path from "node:path";

import { z } from "zod";

import {
	activateLibraryConfig,
	initializeLibraryConfig,
	restorePreviousLibraryConfig,
	rollbackLibraryConfig,
} from "../src/config/library-config/activation";
import {
	LibraryConfigSourceError,
	resolveLibraryConfigPath,
} from "../src/config/library-config/source";
import { utcTimestampSchema } from "../src/config/library-config/primitives";

const usage =
	"Usage: npm run config:activate -- <candidate-path> [target-path]\n       npm run config:activate -- --initialize <seed-path> [target-path]\n       npm run config:activate -- --restore <revision> [target-path]\n       npm run config:activate -- --rollback [target-path] [--health-url <url> | --minimum-updated-at <timestamp>]";
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

type InitializeCommand = {
	kind: "initialize";
	seedPath: string;
	targetPath: string;
};

type RestoreCommand = {
	kind: "restore";
	revision: string;
	targetPath: string;
};

function resolveTargetPath(configuredPath?: string) {
	return configuredPath
		? path.resolve(invocationDirectory, configuredPath)
		: resolveLibraryConfigPath({ environment: "production" });
}

const positionalArgument = z
	.string()
	.min(1)
	.refine((value) => !value.startsWith("--"));
const valueCommandArguments = z.tuple([
	positionalArgument,
	positionalArgument.optional(),
]);
const rollbackArguments = z.union([
	z.tuple([]).transform(() => ({})),
	z.tuple([positionalArgument]).transform(([targetPath]) => ({ targetPath })),
	z
		.tuple([z.literal("--health-url"), z.string().min(1)])
		.transform(([, healthUrl]) => ({ healthUrl })),
	z
		.tuple([
			positionalArgument,
			z.literal("--health-url"),
			z.string().min(1),
		])
		.transform(([targetPath, , healthUrl]) => ({ healthUrl, targetPath })),
	z
		.tuple([z.literal("--minimum-updated-at"), utcTimestampSchema])
		.transform(([, minimumUpdatedAt]) => ({ minimumUpdatedAt })),
	z
		.tuple([
			positionalArgument,
			z.literal("--minimum-updated-at"),
			utcTimestampSchema,
		])
		.transform(([targetPath, , minimumUpdatedAt]) => ({
			minimumUpdatedAt,
			targetPath,
		})),
]);

function requireValueCommand(args: string[]) {
	const parsed = valueCommandArguments.safeParse(args);
	if (!parsed.success) throw new Error(usage);
	const [value, configuredTargetPath] = parsed.data;
	return { configuredTargetPath, value };
}

function parseInitialize(args: string[]): InitializeCommand {
	const { configuredTargetPath, value } = requireValueCommand(args);
	return {
		kind: "initialize",
		seedPath: path.resolve(invocationDirectory, value),
		targetPath: resolveTargetPath(configuredTargetPath),
	};
}

function parseRestore(args: string[]): RestoreCommand {
	const { configuredTargetPath, value } = requireValueCommand(args);
	return {
		kind: "restore",
		revision: value,
		targetPath: resolveTargetPath(configuredTargetPath),
	};
}

function parseActivate(
	candidatePath: string,
	args: string[],
): ActivationCommand {
	const parsed = valueCommandArguments.safeParse([candidatePath, ...args]);
	if (!parsed.success) throw new Error(usage);
	const [configuredCandidatePath, configuredTargetPath] = parsed.data;
	return {
		candidatePath: path.resolve(
			invocationDirectory,
			configuredCandidatePath,
		),
		kind: "activate",
		targetPath: resolveTargetPath(configuredTargetPath),
	};
}

function parseRollback(args: string[]): RollbackCommand {
	const parsed = rollbackArguments.safeParse(args);
	if (!parsed.success) throw new Error(usage);
	const { healthUrl, minimumUpdatedAt, targetPath } = parsed.data as {
		healthUrl?: string;
		minimumUpdatedAt?: string;
		targetPath?: string;
	};
	return {
		healthUrl,
		kind: "rollback",
		minimumUpdatedAt,
		targetPath: resolveTargetPath(targetPath),
	};
}

function parseCommand(
	args: string[],
): ActivationCommand | InitializeCommand | RestoreCommand | RollbackCommand {
	const [command, ...rest] = args;
	if (!command) throw new Error(usage);
	const parser = {
		"--initialize": parseInitialize,
		"--restore": parseRestore,
		"--rollback": parseRollback,
	}[command];
	return parser ? parser(rest) : parseActivate(command, rest);
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

type Command = ReturnType<typeof parseCommand>;

async function executeCommand(command: Command) {
	const executors = {
		activate: (input: ActivationCommand) => activateLibraryConfig(input),
		initialize: (input: InitializeCommand) =>
			initializeLibraryConfig(input),
		restore: (input: RestoreCommand) => restorePreviousLibraryConfig(input),
		rollback: async (input: RollbackCommand) =>
			rollbackLibraryConfig({
				minimumUpdatedAt: input.healthUrl
					? await activeUpdatedAtFromHealth(input.healthUrl)
					: input.minimumUpdatedAt,
				targetPath: input.targetPath,
			}),
	};
	return executors[command.kind](command as never);
}

function actionName(command: Command) {
	return {
		activate: "Activated",
		initialize: "Initialized",
		restore: "Restored",
		rollback: "Restored",
	}[command.kind];
}

function reportError(error: unknown) {
	if (error instanceof LibraryConfigSourceError)
		return printSourceError(error);
	console.error(error instanceof Error ? error.message : error);
}

async function main() {
	try {
		const command = parseCommand(process.argv.slice(2));
		const result = await executeCommand(command);
		console.log(
			`${actionName(command)} library configuration revision ${result.active.revision} at ${result.targetPath}`,
		);
		if (result.previous) {
			console.log(
				`Preserved revision ${result.previous.revision} at ${result.backupPath}`,
			);
		}
	} catch (error) {
		reportError(error);
		process.exitCode = 1;
	}
}

void main();
