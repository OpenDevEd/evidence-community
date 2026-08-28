import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	activateLibraryConfig,
	rollbackLibraryConfig,
} from "../src/config/library-config/activation";
import {
	PLATFORM_LOCALES,
	PLATFORM_SEARCH_SCOPE_OPTIONS,
} from "../src/config/library-config/catalogs";
import {
	libraryConfigSchema,
	type LibraryServerConfig,
} from "../src/config/library-config/schema";
import { getRuntimeSearchScopeOptions } from "../src/config/library-config/search";
import {
	formatRgbChannels,
	parseHexColor,
} from "../src/config/library-config/theme";
import { getOrderedRuntimeLocales } from "../src/i18n/runtime";
import { localesNames, shortLocalesNames } from "../src/i18n/routing";
import { replaceFileAtomically } from "../src/lib/atomic-file";
import { requireLibraryComposeServiceReadiness } from "../src/lib/deployment/library-compose-contract";
import {
	createAdminTestSession,
	type AdminTestSession,
	withAdminTestSession,
} from "./adminSession";

const rootDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const acceptanceDirectory = path.join(rootDirectory, "tests", "acceptance");
const testResultsDirectory = path.join(rootDirectory, "test-results");
const composeFile = path.join(acceptanceDirectory, "compose.yaml");
const libraryComposeFile = path.join(
	rootDirectory,
	"docker",
	"compose.library.yaml",
);
const libraryComposeOverrideFile = path.join(
	acceptanceDirectory,
	"compose.library.override.yaml",
);
const configDirectory = path.join(acceptanceDirectory, "configs");
const composeProject =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT ??
	`evidence-library-acceptance-${process.pid}-${Date.now()}`;
if (!/^[a-z0-9][a-z0-9_-]*$/.test(composeProject)) {
	throw new Error(
		"EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT must contain only lowercase letters, numbers, hyphens, and underscores",
	);
}
const libraryComposeProject = `${composeProject}-library`;
const runtimeDirectory = path.join(
	acceptanceDirectory,
	"runtime",
	composeProject,
);
const image =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE ??
	"evidence-library-acceptance:local";
const searchIndexerImage =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_SEARCH_INDEXER_IMAGE ??
	"evidence-library-acceptance-search-indexer:local";
const sourceSyncImage =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_SOURCE_SYNC_IMAGE ??
	"evidence-library-acceptance-source-sync:local";
const sourceWritebackImage =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_SOURCE_WRITEBACK_IMAGE ??
	"evidence-library-acceptance-source-writeback:local";
const publicationWorkerImage =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_PUBLICATION_WORKER_IMAGE ??
	"evidence-library-acceptance-publication-worker:local";
const acceptanceOpenScholar = {
	amber: {
		libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
		machineCredential: "els_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		secret: "amber-acceptance-auth-secret-0000000000000000",
	},
	indigo: {
		libraryId: "kg2k5yaf2g58kz9kw7h3k2j3v6zq5h4p",
		machineCredential: "els_ccccccccccccccccccccccccccccccccccccccccccc",
		secret: "indigo-acceptance-auth-secret-000000000000000",
	},
} as const;
const cleanupOnly = process.argv.includes("--cleanup");

async function availablePort(environmentValue: string | undefined) {
	if (environmentValue) return environmentValue;
	return new Promise<string>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate a local test port"));
				return;
			}
			server.close((error) => {
				if (error) reject(error);
				else resolve(String(address.port));
			});
		});
	});
}

let meilisearchPort = "";
let amberMeilisearchPort = "";
let indigoMeilisearchPort = "";
let fixturePort = "";
let appHttpsPort = "";
let mailpitPort = "";
let runtimeProviderFakePort = "";
let amberPort = "";
let indigoPort = "";
let libraryComposePort = "";
let postgresPort = "";
const keepRunning = process.argv.includes("--keep");
const skipBuild = process.argv.includes("--skip-build");
const sourceCommit =
	process.env.SOURCE_COMMIT?.trim() ??
	spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: rootDirectory,
		encoding: "utf8",
	}).stdout.trim();

const commandEnvironment: NodeJS.ProcessEnv = {
	...process.env,
	EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE: image,
	EVIDENCE_LIBRARY_ACCEPTANCE_PUBLICATION_WORKER_IMAGE:
		publicationWorkerImage,
	EVIDENCE_LIBRARY_ACCEPTANCE_SEARCH_INDEXER_IMAGE: searchIndexerImage,
	EVIDENCE_LIBRARY_ACCEPTANCE_SOURCE_SYNC_IMAGE: sourceSyncImage,
	EVIDENCE_LIBRARY_ACCEPTANCE_SOURCE_WRITEBACK_IMAGE: sourceWritebackImage,
	EVIDENCE_LIBRARY_ACCEPTANCE_OWNER_PID: String(process.pid),
	EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_AMBER_LIBRARY_ID:
		acceptanceOpenScholar.amber.libraryId,
	EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_AMBER_MACHINE_CREDENTIAL:
		acceptanceOpenScholar.amber.machineCredential,
	EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_INDIGO_LIBRARY_ID:
		acceptanceOpenScholar.indigo.libraryId,
	EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_INDIGO_MACHINE_CREDENTIAL:
		acceptanceOpenScholar.indigo.machineCredential,
	EVIDENCE_LIBRARY_ACCEPTANCE_PERSISTENT: String(keepRunning),
	EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR: runtimeDirectory,
	SOURCE_COMMIT: sourceCommit,
};
const junitReportFiles = new Set<string>();
const ownerLabel = "org.opendeved.evidence-library.acceptance.owner-pid";
const persistentLabel = "org.opendeved.evidence-library.acceptance.persistent";
const composeKindLabel = "org.opendeved.evidence-library.acceptance.compose";

async function initializeAcceptancePorts() {
	[
		meilisearchPort,
		amberMeilisearchPort,
		indigoMeilisearchPort,
		fixturePort,
		appHttpsPort,
		mailpitPort,
		runtimeProviderFakePort,
		amberPort,
		indigoPort,
		libraryComposePort,
		postgresPort,
	] = await Promise.all([
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_MEILI_PORT),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_MEILI_PORT),
		availablePort(
			process.env.EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_MEILI_PORT,
		),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_FIXTURE_PORT),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_APP_HTTPS_PORT),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_MAILPIT_PORT),
		availablePort(
			process.env.EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_PROVIDER_FAKE_PORT,
		),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_PORT),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_PORT),
		availablePort(
			process.env.EVIDENCE_LIBRARY_ACCEPTANCE_LIBRARY_COMPOSE_PORT,
		),
		availablePort(process.env.EVIDENCE_LIBRARY_ACCEPTANCE_POSTGRES_PORT),
	]);
	Object.assign(commandEnvironment, {
		EVIDENCE_LIBRARY_ACCEPTANCE_FIXTURE_PORT: fixturePort,
		EVIDENCE_LIBRARY_ACCEPTANCE_APP_HTTPS_PORT: appHttpsPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_MEILI_PORT: meilisearchPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_MEILI_PORT: amberMeilisearchPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_MEILI_PORT: indigoMeilisearchPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_PROVIDER_FAKE_PORT:
			runtimeProviderFakePort,
		EVIDENCE_LIBRARY_ACCEPTANCE_MAILPIT_PORT: mailpitPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_PORT: amberPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_PORT: indigoPort,
		EVIDENCE_LIBRARY_ACCEPTANCE_LIBRARY_COMPOSE_PORT: libraryComposePort,
		EVIDENCE_LIBRARY_ACCEPTANCE_POSTGRES_PORT: postgresPort,
	});
}

type Profile = {
	config: LibraryServerConfig;
	meilisearchPort: string;
	name: "amber" | "indigo";
	port: string;
};

type MeilisearchTask = {
	status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
	taskUid: number;
	error?: unknown;
};

type RuntimeConfigHealth = {
	state: "active" | "rejected";
	active: {
		revision: string;
		updatedAt: string;
	} | null;
	rejected: {
		revision: string | null;
	} | null;
};

function run(
	command: string,
	args: string[],
	environment = commandEnvironment,
) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: environment,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}`,
		);
	}
}

function playwrightEnvironment(
	label: string,
	environment: NodeJS.ProcessEnv,
) {
	if (!process.env.CI) return environment;
	const suiteResultsDirectory = path.join(testResultsDirectory, label);
	const outputFile = path.join(suiteResultsDirectory, "junit.xml");
	mkdirSync(suiteResultsDirectory, { recursive: true });
	junitReportFiles.add(outputFile);
	return {
		...environment,
		PLAYWRIGHT_JUNIT_OUTPUT_FILE: outputFile,
		PLAYWRIGHT_OUTPUT_DIR: path.join(suiteResultsDirectory, "artifacts"),
	};
}

function verifyJunitReports() {
	if (!process.env.CI) return;
	assert.ok(junitReportFiles.size > 0, "No Playwright JUnit reports expected");
	for (const reportFile of junitReportFiles) {
		assert.match(
			readFileSync(reportFile, "utf8"),
			/<testsuites?\b/u,
			`Playwright JUnit report is missing or invalid: ${reportFile}`,
		);
	}
	console.log(`Wrote ${junitReportFiles.size} Playwright JUnit reports.`);
}

function capture(
	command: string,
	args: string[],
	environment = commandEnvironment,
) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: environment,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}: ${result.stderr}`,
		);
	}
	return result.stdout;
}

function composeForProject(
	project: string,
	projectRuntimeDirectory: string,
	...args: string[]
) {
	run(
		"docker",
		["compose", "--file", composeFile, "--project-name", project, ...args],
		{
			...commandEnvironment,
			EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR: projectRuntimeDirectory,
		},
	);
}

function compose(...args: string[]) {
	composeForProject(composeProject, runtimeDirectory, ...args);
}

function captureCompose(...args: string[]) {
	return capture("docker", [
		"compose",
		"--file",
		composeFile,
		"--project-name",
		composeProject,
		...args,
	]);
}

type ComposeProcess = {
	Health: string;
	Service: string;
	State: string;
};

function libraryComposeArguments(project: string, ...args: string[]) {
	return [
		"compose",
		"--project-directory",
		rootDirectory,
		"--file",
		libraryComposeFile,
		"--file",
		libraryComposeOverrideFile,
		"--project-name",
		project,
		...args,
	];
}

function requireRepositoryComposeServicesReady(processes: ComposeProcess[]) {
	requireLibraryComposeServiceReadiness(
		processes.map((process) => ({
			health: process.Health || null,
			service: process.Service,
			state: process.State,
		})),
	);
}

async function requireHttpSuccess(url: string, description: string) {
	const response = await fetch(url);
	assert.equal(response.status, 200, `${description} must respond`);
	return response;
}

async function requireMethodNotAllowed(url: string, description: string) {
	const response = await fetch(url, { method: "POST", redirect: "manual" });
	await response.body?.cancel();
	assert.equal(
		response.status,
		405,
		`${description} must refuse anything but a page request`,
	);
	assert.equal(
		response.headers.get("allow"),
		"GET, HEAD",
		`${description} must say which methods it accepts`,
	);
}

async function requireHttpRedirect(
	url: string,
	expectedLocationPrefix: string,
	description: string,
) {
	const response = await fetch(url, { redirect: "manual" });
	await response.body?.cancel();
	assert.ok(
		response.status >= 300 && response.status < 400,
		`${description} must redirect, but answered HTTP ${response.status}`,
	);
	// A same-site redirect may name only the path, so read it the way a
	// browser would before comparing it.
	const location = response.headers.get("location") ?? "";
	const destination = location ? new URL(location, url).toString() : "";
	assert.ok(
		destination.startsWith(expectedLocationPrefix),
		`${description} must send the browser to ${expectedLocationPrefix}, but sent it to ${location || "nowhere"}`,
	);
	return response;
}

async function verifyRepositoryComposeStartup(profile: Profile) {
	const config = structuredClone(profile.config);
	config.services.database.url =
		"postgresql://library:library@postgres:5432/library_compose";
	config.services.search.host = "http://meilisearch:7700";
	const environment = {
		...commandEnvironment,
		EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT_NETWORK: `${composeProject}_default`,
		LIBRARY_CONFIG_JSON: JSON.stringify(config),
		MEILISEARCH_MASTER_KEY: config.services.search.key,
	};
	const compose = (...args: string[]) =>
		run(
			"docker",
			libraryComposeArguments(libraryComposeProject, ...args),
			environment,
		);
	captureCompose(
		"exec",
		"--no-TTY",
		"postgres",
		"createdb",
		"--username",
		"library",
		"library_compose",
	);
	const startedAt = Date.now();
	try {
		compose(
			"up",
			"--detach",
			"--wait",
			"--wait-timeout",
			"180",
			"--no-build",
		);
		const processes = capture(
			"docker",
			libraryComposeArguments(
				libraryComposeProject,
				"ps",
				"--all",
				"--format",
				"{{json .}}",
			),
			environment,
		)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as ComposeProcess);
		requireRepositoryComposeServicesReady(processes);

		const baseUrl = `http://127.0.0.1:${libraryComposePort}`;
		const healthResponse = await requireHttpSuccess(
			`${baseUrl}/api/library-config/health`,
			"Configuration health",
		);
		const health = (await healthResponse.json()) as RuntimeConfigHealth;
		assert.equal(health.state, "active");
		assert.equal(health.active?.revision, config.revision);
		assert.equal(health.rejected, null);
		await requireHttpSuccess(
			`${baseUrl}/${config.localization.defaultLocale}/lib`,
			"Public library",
		);
		await requireHttpRedirect(
			`${baseUrl}/admin`,
			config.authentication.openScholar.loginPageUrl,
			"Signed-out admin",
		);
		await requireMethodNotAllowed(`${baseUrl}/admin`, "Signed-out admin");
		const switchedOffLocale = PLATFORM_LOCALES.find(
			(locale) => !config.localization.locales.includes(locale),
		);
		assert.ok(
			switchedOffLocale,
			"The Compose profile must leave one locale switched off",
		);
		await requireHttpRedirect(
			`${baseUrl}/${switchedOffLocale}/admin`,
			`${baseUrl}/admin`,
			"Admin under a switched-off locale",
		);
	} finally {
		compose("down", "--volumes");
	}
	assert.equal(
		capture(
			"docker",
			libraryComposeArguments(
				libraryComposeProject,
				"ps",
				"--all",
				"--quiet",
			),
			environment,
		).trim(),
		"",
		"Repository Compose teardown must remove its containers",
	);
	console.log(
		`Repository Compose started revision ${config.revision} and stopped in ${((Date.now() - startedAt) / 1_000).toFixed(1)} seconds.`,
	);
}

async function verifyBaseAcceptanceServicesSurvived() {
	await waitForComposeServiceHealthy("postgres");
	await waitForComposeServiceHealthy("amber-meilisearch");
	await waitForComposeServiceHealthy("indigo-meilisearch");
	console.log("Repository Compose teardown left the base services healthy.");
}

async function waitForComposeServiceHealthy(
	service: string,
	timeoutMs = 30_000,
) {
	const containerId = captureCompose("ps", "--quiet", service).trim();
	if (!containerId) throw new Error(`${service} does not have a running container`);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = capture("docker", [
			"inspect",
			"--format",
			"{{.State.Health.Status}}",
			containerId,
		]).trim();
		if (status === "healthy") return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${service} did not become healthy after it resumed`);
}

function processIsAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function removeLibraryComposeProject(project: string) {
	const baseProject = project.slice(0, -"-library".length);
	run(
		"docker",
		libraryComposeArguments(
			project,
			"down",
			"--volumes",
			"--remove-orphans",
		),
		{
			...commandEnvironment,
			EVIDENCE_LIBRARY_ACCEPTANCE_LIBRARY_COMPOSE_PORT: "1",
			EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT_NETWORK: `${baseProject}_default`,
			LIBRARY_CONFIG_JSON: "{}",
			MEILISEARCH_MASTER_KEY: "cleanup",
		},
	);
}

function reapAbandonedProjects(options: { includePersistent?: boolean } = {}) {
	const rows = capture("docker", [
		"ps",
		"--all",
		"--filter",
		`label=${ownerLabel}`,
		"--format",
		`{{.Label "com.docker.compose.project"}}|{{.Label "${ownerLabel}"}}|{{.Label "${persistentLabel}"}}|{{.Label "${composeKindLabel}"}}`,
	]);
	const projects = new Map<
		string,
		{ libraryCompose: boolean; ownerPid: number; persistent: boolean }
	>();

	for (const row of rows.split("\n").filter(Boolean)) {
		const [project, ownerPid, persistent, composeKind] = row.split("|");
		if (!project) continue;
		projects.set(project, {
			libraryCompose: composeKind === "library",
			ownerPid: Number(ownerPid),
			persistent: persistent === "true",
		});
	}

	let removedProjects = 0;
	for (const [project, state] of projects) {
		const ownerIsAlive =
			Number.isInteger(state.ownerPid) && processIsAlive(state.ownerPid);
		if (ownerIsAlive || (state.persistent && !options.includePersistent)) {
			if (project === composeProject) {
				throw new Error(
					`Acceptance project ${project} is already in use; choose a different EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT and ports`,
				);
			}
			continue;
		}

		const abandonedRuntimeDirectory = path.join(
			acceptanceDirectory,
			"runtime",
			project,
		);
		console.log(`Removing abandoned acceptance project ${project}`);
		if (state.libraryCompose) {
			removeLibraryComposeProject(project);
		} else {
			composeForProject(
				project,
				abandonedRuntimeDirectory,
				"down",
				"--volumes",
				"--remove-orphans",
			);
		}
		rmSync(abandonedRuntimeDirectory, {
			recursive: true,
			force: true,
		});
		removedProjects += 1;
	}

	return removedProjects;
}

function loadProfile(
	name: Profile["name"],
	port: string,
	meilisearchPort: string,
): Profile {
	const configPath = path.join(configDirectory, `${name}.json`);
	const input = JSON.parse(readFileSync(configPath, "utf8")) as {
		analytics?: { posthog?: { host?: string } };
		authentication?: Record<string, unknown>;
	};
	if (input.analytics?.posthog?.host) {
		const collectorUrl = new URL(input.analytics.posthog.host);
		collectorUrl.port = fixturePort;
		input.analytics.posthog.host = collectorUrl.origin;
	}
	const openScholar = acceptanceOpenScholar[name];
	input.authentication = {
		...input.authentication,
		openScholar: {
			convexSiteUrl: `https://openscholar-convex.localhost:${fixturePort}`,
			libraryId: openScholar.libraryId,
			loginPageUrl: `https://openscholar.localhost:${fixturePort}/evidence-libraries/${name}`,
			machineCredential: openScholar.machineCredential,
		},
		secret: openScholar.secret,
	};
	const config = libraryConfigSchema.parse(input);
	return { config, meilisearchPort, name, port };
}

function prepareRuntimeConfig(profile: Profile) {
	const targetDirectory = path.join(runtimeDirectory, profile.name);
	mkdirSync(targetDirectory, { recursive: true });
	writeFileSync(
		path.join(targetDirectory, "library.json"),
		`${JSON.stringify(profile.config, null, "\t")}\n`,
		"utf8",
	);
}

async function verifyRootOwnedConfigStartup() {
	const containerName = `${composeProject}-config-permissions`;
	const volumeName = `${composeProject}-root-owned-config`;
	const sourceDirectory = path.join(runtimeDirectory, "amber");

	run("docker", ["volume", "create", volumeName]);
	try {
		run("docker", [
			"run",
			"--rm",
			"--volume",
			`${volumeName}:/runtime/config`,
			"--volume",
			`${sourceDirectory}:/source:ro`,
			"node:22-bookworm-slim",
			"sh",
			"-c",
			"cp /source/library.json /runtime/config/library.json && chown 0:0 /runtime/config/library.json && chmod 600 /runtime/config/library.json",
		]);
		run("docker", [
			"run",
			"--detach",
			"--name",
			containerName,
			"--label",
			`${ownerLabel}=${process.pid}`,
			"--label",
			`${persistentLabel}=false`,
			"--env",
			"LIBRARY_CONFIG_PATH=/runtime/config/library.json",
			"--volume",
			`${volumeName}:/runtime/config`,
			image,
		]);

		const deadline = Date.now() + 60_000;
		let healthy = false;
		while (Date.now() < deadline) {
			const result = spawnSync(
				"docker",
				[
					"exec",
					containerName,
					"node",
					"-e",
					"fetch('http://127.0.0.1:3000/api/library-config/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))",
				],
				{ cwd: rootDirectory, env: commandEnvironment },
			);
			if (result.status === 0) {
				healthy = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		assert.equal(
			healthy,
			true,
			"the image must start with a root-owned 0600 library config",
		);
		assert.equal(
			capture("docker", [
				"exec",
				containerName,
				"sh",
				"-c",
				"awk '/^Uid:/ {print $2}' /proc/1/status",
			]).trim(),
			"1001",
			"the web process must run as uid 1001",
		);
		console.log(
			"Root-owned config startup passed and the web process runs as uid 1001.",
		);
	} finally {
		spawnSync("docker", ["rm", "--force", containerName], {
			cwd: rootDirectory,
			env: commandEnvironment,
			stdio: "ignore",
		});
		spawnSync("docker", ["volume", "rm", "--force", volumeName], {
			cwd: rootDirectory,
			env: commandEnvironment,
			stdio: "ignore",
		});
	}
}

async function meilisearchRequest<T>(
	profile: Profile,
	pathname: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(
		`http://127.0.0.1:${profile.meilisearchPort}${pathname}`,
		{
			...init,
			headers: {
				Authorization: "Bearer acceptance-master-key",
				"Content-Type": "application/json",
				...init?.headers,
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`Meilisearch ${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`,
		);
	}
	return response.json() as Promise<T>;
}

async function waitForTask(profile: Profile, taskUid: number) {
	const deadline = Date.now() + 60_000;

	while (Date.now() < deadline) {
		const task = await meilisearchRequest<MeilisearchTask>(
			profile,
			`/tasks/${taskUid}`,
		);
		if (task.status === "succeeded") return;
		if (task.status === "failed" || task.status === "canceled") {
			throw new Error(
				`Meilisearch task ${taskUid} ${task.status}: ${JSON.stringify(task.error)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
}

async function enqueue(
	profile: Profile,
	pathname: string,
	method: "POST" | "PATCH",
	body: unknown,
) {
	const task = await meilisearchRequest<MeilisearchTask>(profile, pathname, {
		method,
		body: JSON.stringify(body),
	});
	await waitForTask(profile, task.taskUid);
}

async function seedSearch(profile: Profile) {
	const indexUid = profile.config.services.search.index;
	const amber = profile.name === "amber";
	const colorName = amber ? "Amber" : "Indigo";
	const institution = amber ? "Amber Institute" : "Indigo Lab";
	const country = amber ? "Morocco" : "United Kingdom";
	const countryCode = amber ? "MA" : "GB";
	const year = amber ? "2026" : "2025";
	const searchItemKey = amber
		? "AMBER_SEARCH_FIXTURE"
		: "INDIGO_SEARCH_FIXTURE";

	await enqueue(profile, `/indexes/${indexUid}/documents`, "POST", [
		{
			key: searchItemKey,
			id: `${colorName.toUpperCase()}_ACCEPTANCE`,
			title: `${colorName} runtime evidence`,
			shortTitle: `${colorName} proof`,
			abstractNote: `This record proves the ${profile.name} deployment selected its own runtime search index.`,
			itemType: "JournalArticle",
			deleted: 0,
			date: year,
			datePublished: year,
			fullNames: [`${amber ? "Amina" : "Iris"} ${colorName}`],
			creators: [
				{
					firstName: amber ? "Amina" : "Iris",
					lastName: colorName,
					creatorType: "author",
					institutions: [
						{
							display_name: institution,
							country_code: countryCode,
						},
					],
				},
			],
			institution: [institution],
			country: [country],
			tags: [],
			collections: [],
			collectionsAncestry: [],
			url: `https://${profile.name}.example.org/evidence/${profile.name}`,
			citation: `<div>${colorName}, A. (${year}). ${colorName} runtime evidence.</div>`,
		},
	]);
}

// Records the whole-library exports and the Atom feed read straight from
// PostgreSQL. Only the first two belong in an export file: an ordinary
// published record, and one carrying the internal badge tag that readers may
// still see. The rest must never appear — hidden by tag, deleted, a child of
// another record, or a draft that was never published. The browser checks
// prove which of them reach an export file.
export const EXPORT_RECORDS = {
	published: { key: "AMBREXP2", title: "Amber export evidence" },
	internal: { key: "AMBRINT2", title: "Amber badged evidence" },
	hidden: { key: "AMBRHID2", title: "Amber unlisted evidence" },
	deleted: { key: "AMBRDEL2", title: "Amber withdrawn evidence" },
	child: { key: "AMBRCHI2", title: "Amber attached evidence" },
	draft: { key: "AMBRDRF2", title: "Amber unfinished evidence" },
} as const;

function seedExportRecords(profile: Profile) {
	if (profile.name !== "amber") return;

	const rows = [
		{
			record: EXPORT_RECORDS.published,
			itemType: "JournalArticle",
			deleted: 0,
			parentItem: "NULL",
			tag: "",
		},
		{
			record: EXPORT_RECORDS.internal,
			itemType: "JournalArticle",
			deleted: 0,
			parentItem: "NULL",
			tag: "internal-only",
		},
		{
			record: EXPORT_RECORDS.hidden,
			itemType: "JournalArticle",
			deleted: 0,
			parentItem: "NULL",
			tag: "hidden-record",
		},
		{
			record: EXPORT_RECORDS.deleted,
			itemType: "JournalArticle",
			deleted: 1,
			parentItem: "NULL",
			tag: "",
		},
		{
			record: EXPORT_RECORDS.child,
			itemType: "Attachment",
			deleted: 0,
			parentItem: `'${EXPORT_RECORDS.published.key}'`,
			tag: "",
		},
	] as const;

	const identity = (key: string) =>
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${key}', 'native', '${key}')`;

	const statements = [
		`INSERT INTO "tag" ("name") VALUES ('hidden-record'), ('internal-only') ON CONFLICT DO NOTHING`,
		...rows.flatMap((row) => [
			identity(row.record.key),
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision", "date", "dateAdded", "deleted", "parentItem") VALUES ('${row.record.key}', 'native', '${row.record.key}', '${row.itemType}', '${row.record.title}', 1, '2026', now(), ${row.deleted}, ${row.parentItem})`,
		]),
		...rows
			.filter((row) => row.tag)
			.map(
				(row) =>
					`INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ('${row.record.key}', '${row.tag}')`,
			),
		// A record that only ever existed as a draft has no published row at
		// all, so no export can reach it.
		identity(EXPORT_RECORDS.draft.key),
		`INSERT INTO "itemDraft" ("itemKey", "sourceConnectionKey", "patch") VALUES ('${EXPORT_RECORDS.draft.key}', 'native', '{"title": "${EXPORT_RECORDS.draft.title}"}'::jsonb)`,
	];

	postgresScalar(profile.name, statements.join("; "));
}

async function seedSharedSearchIndexes(profile: Profile) {
	for (const index of [
		{ uid: "cache", primaryKey: "id" },
		{ uid: "redirects", primaryKey: "id" },
	]) {
		await enqueue(profile, "/indexes", "POST", index);
	}
}

function postgresScalar(database: Profile["name"], sql: string) {
	return captureCompose(
		"exec",
		"--no-TTY",
		"postgres",
		"psql",
		"--set",
		"ON_ERROR_STOP=1",
		"--username",
		"library",
		"--dbname",
		database,
		"--tuples-only",
		"--no-align",
		"--command",
		sql,
	).trim();
}

async function waitForOutboxProcessed(
	profile: Profile,
	key: string,
	description: string,
) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (
			postgresScalar(
				profile.name,
				`SELECT COUNT(*) FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${key}' AND "revision" = 1 AND "processedAt" IS NOT NULL`,
			) === "1"
		) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function meilisearchHasDocument(profile: Profile, key: string) {
	const response = await fetch(
		`http://127.0.0.1:${profile.meilisearchPort}/indexes/items/documents/${key}`,
		{ headers: { Authorization: "Bearer acceptance-master-key" } },
	);
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(
			`${profile.name} Meilisearch document check failed: ${response.status} ${await response.text()}`,
		);
	}
	return true;
}

async function deleteMeilisearchDocument(profile: Profile, key: string) {
	const task = await meilisearchRequest<MeilisearchTask>(
		profile,
		`/indexes/items/documents/${key}`,
		{ method: "DELETE" },
	);
	await waitForTask(profile, task.taskUid);
}

async function verifySearchQueueIsolation(profiles: Profile[]) {
	const amber = profiles.find((profile) => profile.name === "amber");
	const indigo = profiles.find((profile) => profile.name === "indigo");
	assert.ok(amber && indigo, "Both acceptance profiles are required");
	const amberKey = "AMBR6789";
	const indigoKey = "INDG6789";

	compose("pause", "amber-meilisearch");
	try {
		postgresScalar(
			"amber",
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${amberKey}', 'native', '${amberKey}'); INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision") VALUES ('${amberKey}', 'native', '${amberKey}', 'Report', 'Amber isolated queue evidence', 1); INSERT INTO "outbox" ("entityType", "entityKey", "operation", "revision") VALUES ('item', '${amberKey}', 'upsert', 1)`,
		);
		postgresScalar(
			"indigo",
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${indigoKey}', 'native', '${indigoKey}'); INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision") VALUES ('${indigoKey}', 'native', '${indigoKey}', 'Report', 'Indigo isolated queue evidence', 1); INSERT INTO "outbox" ("entityType", "entityKey", "operation", "revision") VALUES ('item', '${indigoKey}', 'upsert', 1)`,
		);

		await waitForOutboxProcessed(
			indigo,
			indigoKey,
			"Indigo indexing while Amber search is paused",
		);
		assert.equal(
			postgresScalar(
				"amber",
				`SELECT COUNT(*) FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${amberKey}' AND "revision" = 1 AND "processedAt" IS NOT NULL`,
			),
			"0",
			"Amber work must remain unfinished while only Amber Meilisearch is paused",
		);
	} finally {
		compose("unpause", "amber-meilisearch");
	}

	await waitForOutboxProcessed(
		amber,
		amberKey,
		"Amber indexing after its search service resumes",
	);
	await waitForComposeServiceHealthy("amber-meilisearch");
	assert.equal(await meilisearchHasDocument(amber, amberKey), true);
	assert.equal(await meilisearchHasDocument(indigo, indigoKey), true);
	assert.equal(await meilisearchHasDocument(amber, indigoKey), false);
	assert.equal(await meilisearchHasDocument(indigo, amberKey), false);
	await Promise.all([
		deleteMeilisearchDocument(amber, amberKey),
		deleteMeilisearchDocument(indigo, indigoKey),
	]);
	postgresScalar(
		"amber",
		`DELETE FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${amberKey}'; DELETE FROM "item" WHERE "key" = '${amberKey}'; DELETE FROM "itemIdentity" WHERE "key" = '${amberKey}'`,
	);
	postgresScalar(
		"indigo",
		`DELETE FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${indigoKey}'; DELETE FROM "item" WHERE "key" = '${indigoKey}'; DELETE FROM "itemIdentity" WHERE "key" = '${indigoKey}'`,
	);
	console.log(
		"Pausing Amber search did not block Indigo, and both search services contain only their own database records.",
	);
}

function publicExpectations(profile: Profile) {
	const { config } = profile;
	const messages = JSON.parse(
		readFileSync(
			path.join(
				rootDirectory,
				"src",
				"messages",
				`${config.localization.defaultLocale}.json`,
			),
			"utf8",
		),
	) as {
		scopes: Record<string, string>;
		ui: Record<string, string>;
	};
	const orderedLocales = getOrderedRuntimeLocales(config.localization);
	const alternateLocales = orderedLocales.filter(
		(locale) => locale !== config.localization.defaultLocale,
	);
	const disabledLocale = PLATFORM_LOCALES.find(
		(locale) => !config.localization.locales.includes(locale),
	);
	if (!disabledLocale) {
		throw new Error(`${profile.name} must leave one locale disabled`);
	}
	const scopes = getRuntimeSearchScopeOptions(config.search);
	const defaultScope =
		scopes.find((scope) => scope.key === config.search.defaultScope) ??
		PLATFORM_SEARCH_SCOPE_OPTIONS[0];
	const externalNavigation = config.navigation.links.find((link) =>
		link.href.startsWith("https://"),
	);
	const logoStyleToken = config.identity.assets.logoStyles
		?.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.at(-1);
	const googleFonts = Array.from(
		new Set(
			[config.theme.fonts.heading, config.theme.fonts.body]
				.filter((font) => font.source === "google")
				.map((font) => font.family),
		),
	);
	const switchLocale = alternateLocales[0];
	const activeTheme =
		config.theme.forcedMode ??
		(config.theme.defaultMode === "system"
			? "light"
			: config.theme.defaultMode);
	const searchItemPrefix = profile.name === "amber" ? "Amber" : "Indigo";
	const databaseItemKey = profile.name === "amber" ? "AMBR2345" : "INDG2345";
	const enabledGapMap = config.gapMaps.find((gapMap) => gapMap.enabled);
	const disabledGapMap = config.gapMaps.find((gapMap) => !gapMap.enabled);

	return {
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${profile.port}`,
		PLAYWRIGHT_RUNTIME_ACCEPTANCE: "true",
		PLAYWRIGHT_EXPECTED_CONFIG_REVISION: config.revision,
		PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT: config.updatedAt,
		PLAYWRIGHT_EXPECTED_TERMS_LINK: config.legal.termsOfService ?? "",
		PLAYWRIGHT_EXPECTED_IDENTITY_NAME: config.identity.name,
		PLAYWRIGHT_EXPECTED_IDENTITY_SHORT_NAME: config.identity.shortName,
		PLAYWRIGHT_EXPECTED_PUBLIC_BASE_URL: config.identity.baseUrl,
		PLAYWRIGHT_EXPECTED_LOGO_URL:
			activeTheme === "dark"
				? config.identity.assets.logoDark
				: config.identity.assets.logoLight,
		PLAYWRIGHT_EXPECTED_LOGO_URLS: [
			config.identity.assets.logoDark,
			config.identity.assets.logoLight,
		].join("|"),
		PLAYWRIGHT_EXPECTED_FAVICON_URL: config.identity.assets.favicon,
		PLAYWRIGHT_EXPECTED_LOGO_STYLE_TOKEN: logoStyleToken ?? "",
		PLAYWRIGHT_EXPECTED_ACCENT_RGB: formatRgbChannels(
			parseHexColor(config.theme.colors.accent),
		),
		PLAYWRIGHT_EXPECTED_GOOGLE_FONT_FAMILIES: googleFonts.join("|"),
		PLAYWRIGHT_EXPECTED_LOADED_LOGO: "true",
		PLAYWRIGHT_EXPECTED_THEME_CLASS: activeTheme,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY: `${searchItemPrefix.toUpperCase()}_SEARCH_FIXTURE`,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_TITLE: `${searchItemPrefix} runtime evidence`,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY: databaseItemKey,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_TITLE: `${searchItemPrefix} database evidence`,
		PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL:
			config.navigation.links[0]?.label ?? "",
		PLAYWRIGHT_EXPECTED_EXTERNAL_NAVIGATION_LABEL:
			externalNavigation?.label ?? "",
		PLAYWRIGHT_EXPECTED_FOOTER_SECTION:
			config.footer.sections[0]?.title ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_EMAIL: config.contact.email ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_PHONE: config.contact.phone ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_ADDRESS:
			config.contact.address?.split("\n")[0] ?? "",
		PLAYWRIGHT_EXPECTED_FUNDER_NAME: config.footer.funders[0]?.name ?? "",
		PLAYWRIGHT_EXPECTED_DISCLAIMER: config.footer.disclaimer ?? "",
		PLAYWRIGHT_EXPECTED_ATTRIBUTION: config.footer.attribution ?? "",
		PLAYWRIGHT_EXPECTED_DEFAULT_LOCALE: config.localization.defaultLocale,
		PLAYWRIGHT_EXPECTED_ENABLED_LOCALES:
			config.localization.locales.join(","),
		PLAYWRIGHT_EXPECTED_DISABLED_LOCALE: disabledLocale,
		PLAYWRIGHT_EXPECTED_DETECTED_LOCALE: config.localization.detectLocale
			? (switchLocale ?? "")
			: "",
		PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER: String(
			config.features.languageSwitcher,
		),
		PLAYWRIGHT_EXPECTED_CURRENT_LOCALE_LABEL:
			shortLocalesNames[config.localization.defaultLocale],
		PLAYWRIGHT_EXPECTED_LOCALE_OPTIONS: alternateLocales
			.map((locale) => localesNames[locale])
			.join("|"),
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE: switchLocale ?? "",
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE_LABEL: switchLocale
			? localesNames[switchLocale]
			: "",
		PLAYWRIGHT_EXPECTED_SWITCH_BACK_LOCALE_LABEL: switchLocale
			? localesNames[config.localization.defaultLocale]
			: "",
		PLAYWRIGHT_EXPECTED_CONSENT_DECLINE: messages.ui.cookieDecline,
		PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT: String(scopes.length),
		PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL:
			messages.scopes[defaultScope.key] ?? defaultScope.name,
		PLAYWRIGHT_EXPECTED_YEAR_FILTER: String(config.filters.years.enabled),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL:
			messages.ui[config.filters.institution.label] ??
			config.filters.institution.label,
		PLAYWRIGHT_EXPECTED_CITATION_URL: String(
			config.citations.showUrl &&
				Boolean(config.services.zotero.translationUrl),
		),
		PLAYWRIGHT_EXPECTED_EMBEDDINGS: String(config.search.embedder !== null),
		PLAYWRIGHT_EXPECTED_COUNTRY_FACET: String(config.search.country),
		PLAYWRIGHT_EXPECTED_AUTHOR_COUNTRY_FACET: String(
			config.search.authorCountry,
		),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FACET: String(
			config.filters.institution.mode !== "hidden",
		),
		PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH: String(config.features.navbarSearch),
		PLAYWRIGHT_EXPECTED_THEME_SWITCHER: String(
			config.features.themeSwitcher,
		),
		PLAYWRIGHT_EXPECTED_LOGIN: String(config.features.login),
		PLAYWRIGHT_EXPECTED_AI: String(config.features.ai),
		PLAYWRIGHT_EXPECTED_AI_SEARCH: String(config.features.aiSearch),
		PLAYWRIGHT_EXPECTED_DEEP_RESEARCH: String(config.features.deepResearch),
		PLAYWRIGHT_EXPECTED_GAP_MAP: String(Boolean(enabledGapMap)),
		PLAYWRIGHT_EXPECTED_EXPORT_RIS: String(
			config.features.downloads && config.exports.ris,
		),
		PLAYWRIGHT_EXPECTED_EXPORT_BIBTEX: String(
			config.features.downloads && config.exports.bibtex,
		),
		PLAYWRIGHT_EXPECTED_EXPORT_ATOM: String(
			config.features.atomFeed && config.exports.atom,
		),
		PLAYWRIGHT_EXPORT_INCLUDED_TITLES:
			profile.name === "amber"
				? [
						EXPORT_RECORDS.published.title,
						EXPORT_RECORDS.internal.title,
					].join("|")
				: "",
		PLAYWRIGHT_EXPORT_EXCLUDED_TITLES:
			profile.name === "amber"
				? [
						EXPORT_RECORDS.hidden.title,
						EXPORT_RECORDS.deleted.title,
						EXPORT_RECORDS.child.title,
						EXPORT_RECORDS.draft.title,
					].join("|")
				: "",
		PLAYWRIGHT_EXPECTED_ANALYTICS: String(
			Boolean(
				config.analytics.posthog.host && config.analytics.posthog.key,
			),
		),
		PLAYWRIGHT_EXPECTED_AUTHENTICATION: String(config.features.login),
		PLAYWRIGHT_EXPECTED_EMAIL: String(
			Boolean(config.email.contactRecipient),
		),
		PLAYWRIGHT_FIXTURE_ORIGIN:
			config.analytics.posthog.host ??
			`https://collector.localhost:${fixturePort}`,
		PLAYWRIGHT_MAILPIT_ORIGIN: `http://127.0.0.1:${mailpitPort}`,
		PLAYWRIGHT_IGNORE_HTTPS_ERRORS: "true",
		PLAYWRIGHT_GAP_MAP_SLUG: enabledGapMap?.slug ?? "",
		PLAYWRIGHT_GAP_MAP_LABEL: enabledGapMap?.label ?? "",
		PLAYWRIGHT_DISABLED_GAP_MAP_SLUG: disabledGapMap?.slug ?? "",
		PLAYWRIGHT_DISABLED_GAP_MAP_LABEL: disabledGapMap?.label ?? "",
		PLAYWRIGHT_GAP_MAP_MARKER: "AMBER_GAP_MAP_FIXTURE",
		PLAYWRIGHT_CONTACT_RECIPIENT: config.email.contactRecipient ?? "",
		PLAYWRIGHT_EMAIL_SENDER: config.email.smtp.from ?? "",
	};
}

function runBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} runtime acceptance suite`);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/smoke.spec.ts",
			"--project",
			"chromium",
		],
		playwrightEnvironment(`${profile.name}-smoke`, {
			...commandEnvironment,
			...publicExpectations(profile),
		}),
	);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/runtime-integrations.spec.ts",
			"--project",
			"chromium",
		],
		playwrightEnvironment(`${profile.name}-integrations`, {
			...commandEnvironment,
			...publicExpectations(profile),
		}),
	);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/runtime-mobile.spec.ts",
			"--project",
			"mobile-chromium",
		],
		playwrightEnvironment(`${profile.name}-mobile`, {
			...commandEnvironment,
			...publicExpectations(profile),
		}),
	);
}

function runAdminBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} admin browser suite`);
	const adminWorkers =
		process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? undefined : "1");
	const environment = playwrightEnvironment(`${profile.name}-admin`, {
		...commandEnvironment,
		...publicExpectations(profile),
		PLAYWRIGHT_BASE_URL: `https://localhost:${appHttpsPort}`,
		EVIDENCE_LIBRARY_OPENSCHOLAR_FAKE_URL: `http://127.0.0.1:${runtimeProviderFakePort}`,
		EVIDENCE_LIBRARY_OPENSCHOLAR_LIBRARY_ID:
			profile.config.authentication.openScholar.libraryId,
		EVIDENCE_LIBRARY_OPENSCHOLAR_WRONG_LIBRARY_ID:
			acceptanceOpenScholar.indigo.libraryId,
		EVIDENCE_LIBRARY_OPENSCHOLAR_LOGIN_PAGE_URL:
			profile.config.authentication.openScholar.loginPageUrl,
		PLAYWRIGHT_ADMIN_UI: "true",
		PLAYWRIGHT_EXPECTED_ADMIN_ITEM_TITLE: "Amber database evidence",
		PLAYWRIGHT_RUNTIME_E2E: "true",
	});
	const runAdminTests = (arguments_: string[]) => {
		run(
			"npx",
			[
				"playwright",
				"test",
				...arguments_,
				...(adminWorkers ? ["--workers", adminWorkers] : []),
			],
			environment,
		);
	};

	runAdminTests([
		"tests/e2e/admin.spec.ts",
		"tests/e2e/admin-runtime.spec.ts",
		"tests/e2e/admin-links.spec.ts",
		"--project",
		"chromium",
	]);
}

function runPublicationBrowserPhase(
	profile: Profile,
	phase: "reserve" | "crossref-settle" | "edit" | "edit-settle" | "zenodo",
) {
	console.log(`\nRunning ${profile.name} DOI admin ${phase} acceptance`);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/admin-publication.spec.ts",
			"--project",
			"chromium",
			"--grep",
			`\\[publication:${phase}\\]`,
			"--workers",
			"1",
		],
		playwrightEnvironment(`${profile.name}-publication-${phase}`, {
			...commandEnvironment,
			EVIDENCE_LIBRARY_OPENSCHOLAR_FAKE_URL: `http://127.0.0.1:${runtimeProviderFakePort}`,
			EVIDENCE_LIBRARY_OPENSCHOLAR_LIBRARY_ID:
				profile.config.authentication.openScholar.libraryId,
			EVIDENCE_LIBRARY_OPENSCHOLAR_LOGIN_PAGE_URL:
				profile.config.authentication.openScholar.loginPageUrl,
			PLAYWRIGHT_BASE_URL: `https://localhost:${appHttpsPort}`,
			PLAYWRIGHT_IGNORE_HTTPS_ERRORS: "true",
			PLAYWRIGHT_PUBLICATION_EXPECTED_DOI: "10.5555/acceptance.000002",
			PLAYWRIGHT_PUBLICATION_EDITED_TITLE:
				"Amber DOI admin interface report — Edited",
			PLAYWRIGHT_PUBLICATION_ITEM_KEY: "PUBUIA23",
			PLAYWRIGHT_PUBLICATION_PHASE: phase,
		}),
	);
}

async function readPublicationProviderState() {
	const response = await fetch(
		`http://127.0.0.1:${runtimeProviderFakePort}/_test/state`,
	);
	assert.equal(response.ok, true);
	return (await response.json()) as {
		crossrefDeposits: number;
		crossref: { doi: string; title: string } | null;
	};
}

async function issueAcceptanceAdminLoginCode() {
	const response = await fetch(
		`http://127.0.0.1:${runtimeProviderFakePort}/_test/admin-login-codes`,
		{ method: "POST" },
	);
	assert.equal(response.status, 201);
	const body = (await response.json()) as { code?: unknown };
	assert.equal(typeof body.code, "string");
	return body.code as string;
}

async function makeCrossrefVerificationDue(itemKey: string) {
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "publicationSyncState"
				 WHERE "itemKey" = '${itemKey}' AND "provider" = 'crossref'
					AND "pendingStage" = 'deposit'`,
			) === "1",
		`Crossref deposit for ${itemKey}`,
	);
	postgresScalar(
		"amber",
		`UPDATE "publicationSyncJob" SET "nextAttemptAt" = now()
		 WHERE "itemKey" = '${itemKey}' AND "provider" = 'crossref'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "publicationSyncJob"
				 WHERE "itemKey" = '${itemKey}' AND "provider" = 'crossref'
					AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL
					AND "supersededAt" IS NULL`,
			) === "0",
		`Crossref verification for ${itemKey}`,
	);
}

async function verifyPublicationAdminInterface(profile: Profile) {
	const providerBefore = await readPublicationProviderState();
	compose("stop", "amber-publication-worker");
	runPublicationBrowserPhase(profile, "reserve");
	compose(
		"up",
		"--wait",
		"--wait-timeout",
		"180",
		"amber-publication-worker",
	);
	await makeCrossrefVerificationDue("PUBUIA23");
	runPublicationBrowserPhase(profile, "crossref-settle");
	runPublicationBrowserPhase(profile, "edit");
	await makeCrossrefVerificationDue("PUBUIA23");
	runPublicationBrowserPhase(profile, "edit-settle");
	runPublicationBrowserPhase(profile, "zenodo");

	const databaseState = JSON.parse(
		postgresScalar(
			"amber",
			`SELECT json_build_object(
				'title', (SELECT "title" FROM "item" WHERE "key" = 'PUBUIA23'),
				'doiCount', (
					SELECT count(*) FROM "publicationIdentifier"
					WHERE "itemKey" = 'PUBUIA23' AND "registrar" = 'crossref'
						AND "isCurrent" = true
				),
				'activationJobs', (
					SELECT count(*) FROM "publicationSyncJob"
					WHERE "itemKey" = 'PUBUIA23' AND "provider" = 'crossref'
						AND "reason" = 'manual_activation' AND "processedAt" IS NOT NULL
				),
				'editJobs', (
					SELECT count(*) FROM "publicationSyncJob"
					WHERE "itemKey" = 'PUBUIA23' AND "provider" = 'crossref'
						AND "reason" = 'record_changed' AND "processedAt" IS NOT NULL
				),
				'failedJobs', (
					SELECT count(*) FROM "publicationSyncJob"
					WHERE "itemKey" = 'PUBUIA23' AND "deadLetteredAt" IS NOT NULL
				)
			)`,
		),
	) as {
		title: string;
		doiCount: number;
		activationJobs: number;
		editJobs: number;
		failedJobs: number;
	};
	assert.deepEqual(databaseState, {
		title: "Amber DOI admin interface report — Edited",
		doiCount: 1,
		activationJobs: 1,
		editJobs: 1,
		failedJobs: 0,
	});
	const providerAfter = await readPublicationProviderState();
	assert.equal(
		providerAfter.crossrefDeposits,
		providerBefore.crossrefDeposits + 2,
	);
	assert.deepEqual(providerAfter.crossref, {
		doi: "10.5555/acceptance.000002",
		title: "Amber DOI admin interface report — Edited",
	});
	console.log(
		"The admin interface reserved a DOI, redeposited an edit under the same DOI, published to Zenodo Sandbox, and retained both states after reload.",
	);
}

function countServerCollectorRequests(logs: string) {
	return logs
		.split("\n")
		.filter(
			(line) =>
				line.includes('"method":"POST"') &&
				/"uri":"\/(?:batch|e)\//u.test(line),
		).length;
}

async function openScholarRead<T>(
	profile: Profile,
	pathname: string,
	credential = profile.config.authentication.openScholar.machineCredential,
) {
	const response = await fetch(`http://127.0.0.1:${profile.port}${pathname}`, {
		headers: { Authorization: `Bearer ${credential}` },
	});
	return { body: (await response.json()) as T, response };
}

type OpenScholarCollectionPage = {
	items: {
		count: number;
		id: string;
		parentId: string | null;
		source: string;
		title: string;
	}[];
	nextCursor: string | null;
};

async function verifyOpenScholarReadApi(profile: Profile) {
	console.log(`\nVerifying ${profile.name} OpenScholar read API`);
	const denied = await openScholarRead(
		profile,
		"/api/openscholar/institutions",
		acceptanceOpenScholar.indigo.machineCredential,
	);
	assert.equal(denied.response.status, 401);

	const institutions = await openScholarRead<{
		items: { count: number; name: string }[];
	}>(profile, "/api/openscholar/institutions");
	assert.equal(institutions.response.status, 200);
	assert.equal(
		institutions.response.headers.get("cache-control"),
		"private, no-store",
	);
	assert.deepEqual(institutions.body.items, [
		{ count: 1, name: "Amber Institute" },
		{ count: 1, name: "Indigo College" },
	]);

	const firstPage = await openScholarRead<OpenScholarCollectionPage>(
		profile,
		"/api/openscholar/collections?pageSize=2",
	);
	assert.equal(firstPage.response.status, 200);
	assert.equal(firstPage.body.items.length, 2);
	assert.ok(firstPage.body.nextCursor, "a second page must exist");
	const secondPage = await openScholarRead<OpenScholarCollectionPage>(
		profile,
		`/api/openscholar/collections?pageSize=2&cursor=${encodeURIComponent(firstPage.body.nextCursor!)}`,
	);
	assert.equal(secondPage.response.status, 200);
	const seen = new Set(
		[...firstPage.body.items, ...secondPage.body.items].map(({ id }) => id),
	);
	assert.equal(
		seen.size,
		firstPage.body.items.length + secondPage.body.items.length,
		"pages must not repeat collections",
	);

	const search = await openScholarRead<OpenScholarCollectionPage>(
		profile,
		"/api/openscholar/collections?query=source",
	);
	assert.deepEqual(search.body, {
		items: [
			{
				count: 1,
				id: "ZBJ4NBSL",
				parentId: null,
				source: "native",
				title: "Amber source collection",
			},
		],
		nextCursor: null,
	});
}

async function verifyOwnerLegalText(profile: Profile) {
	console.log(`\nVerifying ${profile.name} owner-written terms page`);
	const response = await fetch(
		`http://127.0.0.1:${profile.port}/${profile.config.localization.defaultLocale}/terms`,
	);
	assert.equal(response.status, 200);
	const html = await response.text();
	const siteHost = new URL(profile.config.identity.baseUrl).host;
	assert.ok(
		html.includes(`Use ${siteHost} for research and teaching.`),
		"terms page must show the owner's text with the site host filled in",
	);
	assert.ok(
		html.includes("Updated 01 August 2026"),
		"terms page must read the date from the owner's text",
	);
}

function verifyServerAnalyticsTransport(profile: Profile) {
	const { host, key } = profile.config.analytics.posthog;
	if (!host || !key) {
		return;
	}

	const before = countServerCollectorRequests(
		captureCompose("logs", "--no-color", "fixture"),
	);
	const eventName = `acceptance_server_${profile.name}_${Date.now()}`;
	const script = [
		'const { PostHog } = require("posthog-node");',
		"const [host, key, event] = process.argv.slice(1);",
		"const client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });",
		'client.capture({ distinctId: "runtime-acceptance-server", event });',
		"client.shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });",
	].join(" ");
	compose(
		"exec",
		"--no-TTY",
		profile.name,
		"node",
		"--eval",
		script,
		host,
		key,
		eventName,
	);
	const after = countServerCollectorRequests(
		captureCompose("logs", "--no-color", "fixture"),
	);
	assert.ok(
		after > before,
		`${profile.name} server-side PostHog did not reach the configured collector`,
	);
	console.log(
		`${profile.name} server-side PostHog reached the configured HTTPS collector.`,
	);
}

function cleanupAcceptanceUsers() {
	compose(
		"exec",
		"--no-TTY",
		"postgres",
		"psql",
		"--set",
		"ON_ERROR_STOP=1",
		"--username",
		"library",
		"--dbname",
		"amber",
		"--command",
		`DELETE FROM "user" WHERE "email" LIKE 'acceptance-%@example.org'`,
	);
}

async function adminPublicationRequest<T>(
	profile: Profile,
	session: AdminTestSession,
	pathname: string,
	init?: RequestInit,
) {
	const response = await fetch(
		`http://127.0.0.1:${profile.port}${pathname}`,
		{
			...init,
			headers: withAdminTestSession(session, init?.headers),
		},
	);
	const body = await response.text();
	assert.equal(
		response.ok,
		true,
		`${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${body}`,
	);
	return JSON.parse(body) as T;
}

async function waitForPublicationState(
	predicate: () => boolean,
	description: string,
) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function verifyPublicationLifecycle(profile: Profile) {
	const session = await createAdminTestSession(
		`http://127.0.0.1:${profile.port}`,
		await issueAcceptanceAdminLoginCode(),
	);
	await adminPublicationRequest(
		profile,
		session,
		"/api/admin/items/PUBACC23/publication/crossref/activate",
		{ method: "POST" },
	);
	await adminPublicationRequest(
		profile,
		session,
		"/api/admin/items/PUBACC23/publication/zenodo/activate",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ identifierPolicy: "reuse-crossref" }),
		},
	);
	compose(
		"up",
		"--wait",
		"--wait-timeout",
		"180",
		"amber-publication-worker",
	);
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "publicationSyncState"
				 WHERE "itemKey" = 'PUBACC23' AND "provider" = 'crossref'
					AND "pendingStage" = 'deposit'`,
			) === "1",
		"Crossref test deposit acceptance",
	);
	postgresScalar(
		"amber",
		`UPDATE "publicationSyncJob" SET "nextAttemptAt" = now()
		 WHERE "itemKey" = 'PUBACC23' AND "provider" = 'crossref'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "publicationSyncState"
				 WHERE "itemKey" = 'PUBACC23' AND "provider" = 'zenodo'
					AND "lastPayloadHash" IS NOT NULL
					AND "lastFileManifestHash" IS NOT NULL
					AND "zenodoRecordId" IS NOT NULL`,
			) === "1",
		"Zenodo Sandbox publication settlement",
	);
	const databaseState = JSON.parse(
		postgresScalar(
			"amber",
			`SELECT json_build_object(
				'crossrefVerified', (
					SELECT count(*) FROM "publicationIdentifier"
					WHERE "itemKey" = 'PUBACC23' AND "registrar" = 'crossref'
						AND "lifecycle" = 'verified' AND "isCurrent" = true
				),
				'zenodoSettled', (
					SELECT count(*) FROM "publicationSyncState"
					WHERE "itemKey" = 'PUBACC23' AND "provider" = 'zenodo'
						AND "lastPayloadHash" IS NOT NULL
				),
				'failedJobs', (
					SELECT count(*) FROM "publicationSyncJob"
					WHERE "itemKey" = 'PUBACC23' AND "deadLetteredAt" IS NOT NULL
				)
			)`,
		),
	) as {
		crossrefVerified: number;
		zenodoSettled: number;
		failedJobs: number;
	};
	assert.deepEqual(databaseState, {
		crossrefVerified: 1,
		zenodoSettled: 1,
		failedJobs: 0,
	});
	const providerResponse = await fetch(
		`http://127.0.0.1:${runtimeProviderFakePort}/_test/state`,
	);
	assert.equal(providerResponse.ok, true);
	const providerState = (await providerResponse.json()) as {
		crossrefDeposits: number;
		zenodo: Array<{
			id: string;
			published: boolean;
			doi: string | null;
			files: string[];
		}>;
	};
	assert.equal(providerState.crossrefDeposits, 1);
	assert.deepEqual(providerState.zenodo, [
		{
			id: "7001",
			published: true,
			doi: "10.5555/acceptance.000001",
			files: ["amber-doi-acceptance.pdf"],
		},
	]);
	const overview = await adminPublicationRequest<{
		providers: { crossref: boolean; zenodo: boolean };
		queue: { hasFailed: boolean };
		worker: { active: boolean; ready: boolean } | null;
	}>(profile, session, "/api/admin/publication");
	assert.deepEqual(overview.providers, { crossref: true, zenodo: true });
	assert.equal(overview.queue.hasFailed, false);
	assert.equal(overview.worker?.active, true);
	assert.equal(overview.worker?.ready, true);
	console.log(
		"Crossref Test and Zenodo Sandbox publication passed through the real local worker.",
	);
}

async function verifyZenodoReuseExternalLifecycle(profile: Profile) {
	const itemKey = "PUBEXT23";
	const removedFileKey = "PUBEXPA3";
	const externalDoi = "10.1038/nature12373";
	const session = await createAdminTestSession(
		`http://127.0.0.1:${profile.port}`,
		await issueAcceptanceAdminLoginCode(),
	);

	await adminPublicationRequest(
		profile,
		session,
		`/api/admin/items/${itemKey}/publication/zenodo/activate`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ identifierPolicy: "reuse-external" }),
		},
	);
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "publicationSyncState"
				 WHERE "itemKey" = '${itemKey}' AND "provider" = 'zenodo'
					AND "lastFileManifestHash" IS NOT NULL
					AND "zenodoRecordId" IS NOT NULL`,
			) === "1",
		"external DOI Zenodo publication settlement",
	);

	await adminPublicationRequest(
		profile,
		session,
		`/api/admin/items/${removedFileKey}/file`,
		{
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ zenodoFileChange: "minor_correction" }),
		},
	);
	await waitForPublicationState(
		() =>
			postgresScalar(
				"amber",
				`SELECT count(*) FROM "zenodoFileCorrectionApproval"
				 WHERE "itemKey" = '${itemKey}' AND "consumedAt" IS NOT NULL`,
			) === "1",
		"external DOI file correction settlement",
	);

	const databaseState = JSON.parse(
		postgresScalar(
			"amber",
			`SELECT json_build_object(
				'externalDoi', (
					SELECT "doi" FROM "publicationIdentifier"
					WHERE "itemKey" = '${itemKey}' AND "registrar" = 'zenodo'
						AND "role" = 'version' AND "ownership" = 'external'
						AND "lifecycle" = 'verified' AND "isCurrent" = true
				),
				'publishedFiles', (
					SELECT count(*) FROM "itemFilePublication"
					WHERE "parentItemKey" = '${itemKey}'
				),
				'consumedApprovals', (
					SELECT count(*) FROM "zenodoFileCorrectionApproval"
					WHERE "itemKey" = '${itemKey}' AND "consumedAt" IS NOT NULL
				),
				'failedJobs', (
					SELECT count(*) FROM "publicationSyncJob"
					WHERE "itemKey" = '${itemKey}' AND "deadLetteredAt" IS NOT NULL
				)
			)`,
		),
	) as {
		externalDoi: string;
		publishedFiles: number;
		consumedApprovals: number;
		failedJobs: number;
	};
	assert.deepEqual(databaseState, {
		externalDoi,
		publishedFiles: 1,
		consumedApprovals: 1,
		failedJobs: 0,
	});

	const providerResponse = await fetch(
		`http://127.0.0.1:${runtimeProviderFakePort}/_test/state`,
	);
	assert.equal(providerResponse.ok, true);
	const providerState = (await providerResponse.json()) as {
		zenodo: Array<{
			id: string;
			doi: string | null;
			files: string[];
			published: boolean;
		}>;
	};
	const archive = providerState.zenodo.find(
		(record) => record.doi === externalDoi,
	);
	assert.ok(archive, "The local Zenodo fake did not retain the external DOI record");
	assert.equal(archive.doi, externalDoi);
	assert.deepEqual(archive.files, ["amber-external-doi-b.pdf"]);
	assert.equal(archive.published, true);
	console.log(
		"Amber archived an external DOI and completed a confirmed PDF correction against the local Zenodo fake.",
	);
}

async function waitForRuntimeHealth(
	profile: Profile,
	predicate: (health: RuntimeConfigHealth) => boolean,
	description: string,
) {
	const deadline = Date.now() + 20_000;
	let lastHealth: RuntimeConfigHealth | null = null;
	let lastError: unknown = null;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${profile.port}/api/library-config/health`,
			);
			lastHealth = (await response.json()) as RuntimeConfigHealth;
			if (predicate(lastHealth)) return lastHealth;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error(
		`Timed out waiting for ${description}; last health: ${JSON.stringify(lastHealth)}; last error: ${String(lastError)}`,
	);
}

async function expectRenderedIdentity(profile: Profile, expectedName: string) {
	const response = await fetch(
		`http://127.0.0.1:${profile.port}/${profile.config.localization.defaultLocale}/lib`,
	);
	assert.equal(response.status, 200);
	assert.ok((await response.text()).includes(expectedName));
}

async function observeAtomicActivation(
	profile: Profile,
	allowedRevisions: readonly string[],
	transition: () => Promise<unknown>,
) {
	let finished = false;
	let lastObservationError: unknown = null;
	const observations: RuntimeConfigHealth[] = [];
	const observer = (async () => {
		do {
			try {
				const response = await fetch(
					`http://127.0.0.1:${profile.port}/api/library-config/health`,
				);
				observations.push(
					(await response.json()) as RuntimeConfigHealth,
				);
			} catch (error) {
				if (finished) throw error;
				lastObservationError = error;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		} while (!finished);
	})();

	let transitionError: unknown;
	try {
		await transition();
	} catch (error) {
		transitionError = error;
	} finally {
		finished = true;
		try {
			await observer;
		} catch (error) {
			if (!transitionError) throw error;
		}
	}
	if (transitionError) throw transitionError;

	assert.ok(
		observations.length > 0,
		`No runtime health observations were captured; last error: ${String(lastObservationError)}`,
	);
	for (const health of observations) {
		assert.equal(health.state, "active");
		assert.equal(health.rejected, null);
		assert.ok(
			health.active && allowedRevisions.includes(health.active.revision),
			`Unexpected revision during atomic activation: ${JSON.stringify(health)}`,
		);
	}
}

function containerIdentity(service: Profile["name"]) {
	const containerId = captureCompose("ps", "--quiet", service).trim();
	assert.ok(containerId, `No running ${service} container found`);
	return capture("docker", [
		"inspect",
		"--format",
		"{{.Id}}|{{.Image}}",
		containerId,
	]).trim();
}

function timestampAfter(timestamp: string, milliseconds: number) {
	return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

async function verifyLiveConfigLifecycle(profile: Profile) {
	const targetPath = path.join(
		runtimeDirectory,
		profile.name,
		"library.json",
	);
	const candidatePath = path.join(
		runtimeDirectory,
		profile.name,
		"candidate.json",
	);
	const originalIdentity = containerIdentity(profile.name);
	const activated = structuredClone(profile.config);
	activated.revision = `${profile.config.revision}-activated`;
	activated.updatedAt = timestampAfter(profile.config.updatedAt, 60_000);
	activated.identity.name = "Amber Live Activation";
	await writeFile(
		candidatePath,
		JSON.stringify(activated, null, "\t"),
		"utf8",
	);

	await observeAtomicActivation(
		profile,
		[profile.config.revision, activated.revision],
		() => activateLibraryConfig({ candidatePath, targetPath }),
	);
	const activatedHealth = await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "active" &&
			health.active?.revision === activated.revision &&
			health.rejected === null,
		"valid configuration activation",
	);
	await expectRenderedIdentity(profile, activated.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);

	const invalid = structuredClone(activated);
	invalid.revision = `${profile.config.revision}-rejected`;
	invalid.updatedAt = timestampAfter(activated.updatedAt, 60_000);
	const targetMode = (await stat(targetPath)).mode & 0o777;
	invalid.identity.name = "";
	await replaceFileAtomically({
		content: `${JSON.stringify(invalid, null, "\t")}\n`,
		mode: targetMode,
		targetPath,
	});
	await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "rejected" &&
			health.active?.revision === activated.revision &&
			health.rejected?.revision === invalid.revision,
		"invalid configuration rejection with last-valid retention",
	);
	await expectRenderedIdentity(profile, activated.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);

	const rollback = await rollbackLibraryConfig({
		minimumUpdatedAt: activatedHealth.active?.updatedAt,
		targetPath,
	});
	profile.config = rollback.active;
	await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "active" &&
			health.active?.revision === rollback.active.revision &&
			health.rejected === null,
		"configuration rollback",
	);
	await expectRenderedIdentity(profile, profile.config.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);
	console.log(
		`${profile.name} live config activation, rejection, retention, and rollback passed without a container restart.`,
	);
}

async function main() {
	if (cleanupOnly) {
		const removedProjects = reapAbandonedProjects({
			includePersistent: true,
		});
		console.log(
			removedProjects === 0
				? "No abandoned acceptance projects found."
				: `Removed ${removedProjects} abandoned acceptance project${removedProjects === 1 ? "" : "s"}.`,
		);
		return;
	}

	await initializeAcceptancePorts();
	reapAbandonedProjects();
	const profiles = [
		loadProfile("amber", amberPort, amberMeilisearchPort),
		loadProfile("indigo", indigoPort, indigoMeilisearchPort),
	];

	rmSync(runtimeDirectory, { recursive: true, force: true });
	profiles.forEach(prepareRuntimeConfig);

	try {
		if (!skipBuild) {
			run("docker", [
				"buildx",
				"bake",
				"--file",
				"docker-bake.acceptance.hcl",
				"--load",
				"--set",
				`app.tags=${image}`,
				"--set",
				`search-indexer.tags=${searchIndexerImage}`,
				"--set",
				`source-sync.tags=${sourceSyncImage}`,
				"--set",
				`source-writeback.tags=${sourceWritebackImage}`,
				"--set",
				`publication-worker.tags=${publicationWorkerImage}`,
				"acceptance",
			]);
		}
		await verifyRootOwnedConfigStartup();
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"postgres",
			"amber-meilisearch",
			"indigo-meilisearch",
		);
		await verifyRepositoryComposeStartup(profiles[0]);
		await verifyBaseAcceptanceServicesSurvived();
		for (const profile of profiles) {
			await seedSharedSearchIndexes(profile);
		}
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"amber-search-indexer",
			"indigo-search-indexer",
		);
		for (const profile of profiles) {
			assert.equal(
				postgresScalar(
					profile.name,
					`SELECT "searchIndexRebuildPending" FROM "status" WHERE "id" = 1`,
				),
				"f",
				`${profile.name} search rebuild marker must clear before worker health passes`,
			);
		}
		for (const profile of profiles) {
			await seedSearch(profile);
			seedExportRecords(profile);
		}
		await verifySearchQueueIsolation(profiles);
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"amber",
			"indigo",
			"amber-search-indexer",
			"indigo-search-indexer",
		);
		await verifyLiveConfigLifecycle(profiles[0]);
		await verifyPublicationLifecycle(profiles[0]);
		await verifyZenodoReuseExternalLifecycle(profiles[0]);
		await verifyPublicationAdminInterface(profiles[0]);
		await verifyOpenScholarReadApi(profiles[0]);
		await verifyOwnerLegalText(profiles[0]);
		profiles.forEach(verifyServerAnalyticsTransport);
		profiles.forEach(runBrowserSuite);
		runAdminBrowserSuite(profiles[0]);
		verifyJunitReports();
		cleanupAcceptanceUsers();
		console.log("\nRuntime acceptance passed for Amber and Indigo.");
		if (keepRunning) {
			console.log(
				`Amber: http://127.0.0.1:${amberPort}\nIndigo: http://127.0.0.1:${indigoPort}\nCompose project: ${composeProject}`,
			);
		}
	} catch (error) {
		compose(
			"logs",
			"--no-color",
			"--tail",
			"200",
			"amber",
			"indigo",
			"fixture",
			"runtime-provider-fake",
			"amber-publication-worker",
			"mailpit",
			"postgres",
			"amber-meilisearch",
			"indigo-meilisearch",
		);
		throw error;
	} finally {
		if (!keepRunning) {
			compose("down", "--volumes", "--remove-orphans");
			rmSync(runtimeDirectory, {
				recursive: true,
				force: true,
			});
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
