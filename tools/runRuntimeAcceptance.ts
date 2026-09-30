import { projectPublicLibraryConfig } from "../src/config/library-config/public";
import { getRuntimeLinkHref, getVisibleRuntimeLinks } from "../src/config/library-config/links";
import { analyticsCapabilities } from "../src/lib/analytics-consent";
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import { PgDialect } from "drizzle-orm/pg-core";

const subscriptionToken = randomBytes(32).toString("hex");
const digestEditionId = "018e4a68-274a-487a-a7ce-dbb7f930f271";
const digestTitle = "Reading routines in the classroom";

import { parseOpenScholarInstitutionRequest } from "../src/lib/admin/institution-catalog-contract";
import { buildInstitutionCountsQuery } from "../src/lib/admin/openscholar-institutions";
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
const repositoryComposeOnly = process.argv.includes("--repository-compose");

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
	RUNTIME_IMAGE: image,
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

const backgroundRuns = new Set<ChildProcess>();
let stopBackgroundRuns = false;

/**
 * Starts a command without blocking the steps that follow it. Its output goes
 * to a file and is printed in one piece when it ends, so it never interleaves
 * with the steps running beside it.
 */
function runInBackground(
	label: string,
	command: string,
	args: string[],
	environment = commandEnvironment,
) {
	if (stopBackgroundRuns) {
		const skipped = Promise.reject(new Error(`${label} was not started`));
		skipped.catch(() => undefined);
		return skipped;
	}
	// Outside test-results, which Playwright empties when it starts locally.
	const logDirectory = path.join(runtimeDirectory, "logs");
	mkdirSync(logDirectory, { recursive: true });
	const logFile = path.join(logDirectory, `${label}.log`);
	const output = openSync(logFile, "w");
	const child = spawn(command, args, {
		cwd: rootDirectory,
		env: environment,
		stdio: ["ignore", output, output],
	});
	closeSync(output);
	backgroundRuns.add(child);
	const finished = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (status) => {
			backgroundRuns.delete(child);
			// A failed run may already have removed the runtime directory.
			const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
			console.log(`\n${label}:\n${log}`);
			if (status === 0) resolve();
			else {
				reject(
					new Error(`${command} ${args.join(" ")} exited with status ${status}`),
				);
			}
		});
	});
	// The caller awaits this later; a failure before then must not end the process.
	finished.catch(() => undefined);
	return finished;
}

function descendants(pid: number): number[] {
	const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
		.stdout.split("\n")
		.filter(Boolean)
		.map(Number);
	return children.flatMap((child) => [child, ...descendants(child)]);
}

function signalProcessTree(pid: number) {
	for (const member of [pid, ...descendants(pid)]) {
		try {
			process.kill(member, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
}

/**
 * Stops every background run, including the Playwright or Compose process
 * its npx or tsx wrapper started, and waits for them before cleanup begins.
 */
async function stopRunsInBackground() {
	stopBackgroundRuns = true;
	const running = [...backgroundRuns];
	const closed = running.map(
		(child) => new Promise((resolve) => child.once("close", resolve)),
	);
	for (const child of running) {
		if (child.pid !== undefined) signalProcessTree(child.pid);
	}
	await Promise.all(closed);
}

function playwrightEnvironment(label: string, environment: NodeJS.ProcessEnv) {
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
	assert.ok(
		junitReportFiles.size > 0,
		"No Playwright JUnit reports expected",
	);
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

async function requireConfigurationWrite(
	url: string,
	machineCredential: string,
	method: "DELETE" | "PUT",
	body: unknown,
) {
	const response = await fetch(url, {
		body: JSON.stringify(body),
		headers: {
			authorization: `Bearer ${machineCredential}`,
			"content-type": "application/json",
		},
		method,
	});
	const responseBody = await response.text();
	assert.equal(response.status, 200, responseBody);
	return JSON.parse(responseBody) as {
		revision: string;
		sourceSha256?: string;
		status: "active";
	};
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

// A same-site redirect may name only the path, so read the destination the
// way a browser would before comparing it.
function redirectDestination(response: Response, requestUrl: string) {
	const location = response.headers.get("location");
	return location ? new URL(location, requestUrl).toString() : "nowhere";
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
	const destination = redirectDestination(response, url);
	assert.ok(
		destination.startsWith(expectedLocationPrefix),
		`${description} must send the browser to ${expectedLocationPrefix}, but sent it to ${destination}`,
	);
	return response;
}

async function verifyRepositoryComposeStartup(profile: Profile) {
	const config = structuredClone(profile.config);
	config.services.database.url =
		"postgresql://library:library@postgres:5432/library_compose";
	config.services.search.host = "http://meilisearch:7700";
	// The production alias, which only this stack's private network carries.
	config.services.redis = { url: "redis://evidence-library-redis:6379" };
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
	const readComposeProcesses = () =>
		capture(
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
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ComposeProcess);
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
		requireRepositoryComposeServicesReady(readComposeProcesses());

		const baseUrl = `http://127.0.0.1:${libraryComposePort}`;
		const healthResponse = await requireHttpSuccess(
			`${baseUrl}/api/library-config/health`,
			"Configuration health",
		);
		const health = (await healthResponse.json()) as RuntimeConfigHealth;
		assert.equal(health.state, "active");
		assert.equal(health.active?.revision, config.revision);
		assert.equal(health.rejected, null);
		const appServices = [
			"web",
			"search-indexer",
			"source-sync",
			"source-writeback",
			"publication-worker",
		] as const;
		const containerState = (service: (typeof appServices)[number]) => {
			const id = capture(
				"docker",
				libraryComposeArguments(
					libraryComposeProject,
					"ps",
					"--quiet",
					service,
				),
				environment,
			).trim();
			assert.ok(id, `${service} container is missing`);
			const [inspection] = JSON.parse(
				capture("docker", ["inspect", id], environment),
			) as Array<{
				Id: string;
				RestartCount: number;
				State: { Health?: { Status?: string }; Status: string };
			}>;
			assert.ok(inspection, `${service} container inspection is empty`);
			return {
				containerId: inspection.Id,
				health: inspection.State.Health?.Status ?? "none",
				restartCount: inspection.RestartCount,
				status: inspection.State.Status,
			};
		};
		const initialContainers = Object.fromEntries(
			appServices.map((service) => [service, containerState(service)]),
		) as Record<
			(typeof appServices)[number],
			ReturnType<typeof containerState>
		>;
		const activated = structuredClone(config);
		activated.revision = `${config.revision}-http-activated`;
		activated.updatedAt = timestampAfter(config.updatedAt, 60_000);
		activated.identity.name = "Repository Compose Live Activation";
		const serialized = JSON.stringify(activated);
		const activation = await requireConfigurationWrite(
			`${baseUrl}/api/openscholar/configuration`,
			config.authentication.openScholar.machineCredential,
			"PUT",
			activated,
		);
		assert.deepEqual(activation, {
			revision: activated.revision,
			sourceSha256: createHash("sha256").update(serialized).digest("hex"),
			status: "active",
		});
		await waitForRepositoryComposeRevision(baseUrl, activated.revision);
		await waitForRepositoryComposeWorkerRestarts(
			appServices.slice(1),
			initialContainers,
			containerState,
		);
		requireRepositoryComposeServicesReady(readComposeProcesses());
		assert.deepEqual(containerState("web"), initialContainers.web);
		const activatedPage = await requireHttpSuccess(
			`${baseUrl}/${config.localization.defaultLocale}/lib`,
			"Activated public library",
		);
		assert.ok(
			(await activatedPage.text()).includes(activated.identity.name),
		);

		const beforeRestore = Object.fromEntries(
			appServices.map((service) => [service, containerState(service)]),
		) as Record<
			(typeof appServices)[number],
			ReturnType<typeof containerState>
		>;
		const restored = await requireConfigurationWrite(
			`${baseUrl}/api/openscholar/configuration`,
			config.authentication.openScholar.machineCredential,
			"DELETE",
			{ revision: config.revision },
		);
		assert.deepEqual(restored, {
			revision: config.revision,
			status: "active",
		});
		await waitForRepositoryComposeRevision(baseUrl, config.revision);
		await waitForRepositoryComposeWorkerRestarts(
			appServices.slice(1),
			beforeRestore,
			containerState,
		);
		requireRepositoryComposeServicesReady(readComposeProcesses());
		assert.deepEqual(containerState("web"), initialContainers.web);
		await requireHttpSuccess(
			`${baseUrl}/${config.localization.defaultLocale}/lib`,
			"Public library",
		);

		const redeployed = structuredClone(config);
		redeployed.identity.name = "Repository Compose Deployment Seed";
		environment.LIBRARY_CONFIG_JSON = JSON.stringify(redeployed);
		compose(
			"up",
			"--detach",
			"--wait",
			"--wait-timeout",
			"180",
			"--force-recreate",
			"--no-build",
		);
		requireRepositoryComposeServicesReady(readComposeProcesses());
		await waitForRepositoryComposeRevision(baseUrl, redeployed.revision);
		const redeployedPage = await requireHttpSuccess(
			`${baseUrl}/${config.localization.defaultLocale}/lib`,
			"Redeployed public library",
		);
		assert.ok(
			(await redeployedPage.text()).includes(redeployed.identity.name),
			"A changed deployment seed must replace the persistent runtime configuration even when the owner revision is unchanged",
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
	} catch (error) {
		run(
			"docker",
			libraryComposeArguments(
				libraryComposeProject,
				"logs",
				"--no-color",
				"--tail",
				"200",
			),
			environment,
		);
		throw error;
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

async function waitForRepositoryComposeRevision(
	baseUrl: string,
	revision: string,
) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if ((await repositoryComposeRevision(baseUrl)) === revision) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Repository Compose did not serve revision ${revision}`);
}

async function repositoryComposeRevision(baseUrl: string) {
	// Recreating the web container closes any in-flight socket. The bounded
	// caller keeps polling and still fails if health does not return.
	const response = await fetch(`${baseUrl}/api/library-config/health`).catch(
		() => new Response(null, { status: 503 }),
	);
	if (!response.ok) return null;
	const health = (await response.json()) as RuntimeConfigHealth;
	if (!health.active) return null;
	return health.active.revision;
}

async function waitForRepositoryComposeWorkerRestarts<T extends string>(
	services: readonly T[],
	previous: Record<T | "web", { containerId: string; restartCount: number }>,
	read: (service: T) => {
		containerId: string;
		health: string | undefined;
		restartCount: number;
		status: string;
	},
) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (
			services.every((service) => {
				const current = read(service);
				return (
					current.containerId === previous[service].containerId &&
					current.restartCount > previous[service].restartCount &&
					current.status === "running" &&
					(current.health === "none" || current.health === "healthy")
				);
			})
		)
			return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		"Repository Compose workers did not restart for the new configuration",
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
	if (!containerId)
		throw new Error(`${service} does not have a running container`);
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
		? "AMBR3456"
		: "INDG3456";

	const document = {
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
				authorProfileId: `${profile.name}acceptanceauthor`,
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
	};
	// Search results refer to real published records, as they do in a library.
	postgresScalar(profile.name, [
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${searchItemKey}', 'native', '${searchItemKey}')`,
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "shortTitle", "abstractNote", "date", "creators", "url", "citation") VALUES ('${searchItemKey}', 'native', '${searchItemKey}', '${document.itemType}', '${document.title}', '${document.shortTitle}', '${document.abstractNote}', '${document.date}', $seed$${JSON.stringify(document.creators)}$seed$::jsonb, '${document.url}', $seed$${document.citation}$seed$)`,
		`INSERT INTO "itemInstitution" ("itemKey", "institutionName") VALUES ('${searchItemKey}', '${institution}')`,
	].join('; '));
	await enqueue(profile, `/indexes/${indexUid}/documents`, "POST", [document]);
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

// The owner writes their redirect list in an ordinary note inside the
// library. These rows prove the lookup reads the live note and nothing else.
// Only AMBRRED2 may be used. A deleted note, a note that was never published,
// a child record, a tag that differs only by capital letters, and a tag shaped
// like a database attack must all be ignored.
//
// Every note that must be ignored owns an address that no other note mentions,
// and the live note shares its addresses with nobody. The lookup reads one
// note per request, so if the addresses overlapped a request could come back
// empty simply because the database handed back the live note that day, and
// the check would pass even with a broken filter. Separate addresses mean an
// empty answer can only come from the note being left out.
const REDIRECT_NOTE_DESTINATION = `/lib/${EXPORT_RECORDS.published.key}`;
const REDIRECT_HOSTILE_TAG = `redirect-record'; DROP TABLE "item"; --`;

function seedRedirectNotes(profile: Profile) {
	if (profile.name !== "amber") return;

	const liveNote = [
		"# A line starting with a hash is a note to the owner",
		`old-report/2024 = ${REDIRECT_NOTE_DESTINATION}`,
		`terms/archive = ${REDIRECT_NOTE_DESTINATION}`,
	].join("\n");

	const notes = [
		{
			key: "AMBRRED2",
			itemType: "Note",
			deleted: 0,
			parentItem: "NULL",
			note: liveNote,
			tag: "redirect-record",
		},
		{
			key: "AMBRRED3",
			itemType: "Note",
			deleted: 1,
			parentItem: "NULL",
			note: `deleted-only/2024 = ${REDIRECT_NOTE_DESTINATION}`,
			tag: "redirect-record",
		},
		{
			key: "AMBRRED4",
			itemType: "Attachment",
			deleted: 0,
			parentItem: `'${EXPORT_RECORDS.published.key}'`,
			note: `child-only/2024 = ${REDIRECT_NOTE_DESTINATION}`,
			tag: "redirect-record",
		},
		{
			key: "AMBRRED5",
			itemType: "Note",
			deleted: 0,
			parentItem: "NULL",
			note: `Case-Only/2024 = ${REDIRECT_NOTE_DESTINATION}`,
			tag: "Redirect-Record",
		},
		{
			key: "AMBRRED6",
			itemType: "Note",
			deleted: 0,
			parentItem: "NULL",
			note: `injected-only/2024 = ${REDIRECT_NOTE_DESTINATION}`,
			tag: REDIRECT_HOSTILE_TAG,
		},
	] as const;

	const literal = (value: string) => `$seed$${value}$seed$`;
	const statements = [
		`INSERT INTO "tag" ("name") VALUES ('redirect-record'), ('Redirect-Record'), (${literal(
			REDIRECT_HOSTILE_TAG,
		)}) ON CONFLICT DO NOTHING`,
		...notes.flatMap((row) => [
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${row.key}', 'native', '${row.key}')`,
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "note", "revision", "dateAdded", "deleted", "parentItem") VALUES ('${row.key}', 'native', '${row.key}', '${row.itemType}', ${literal(
				row.note,
			)}, 1, now(), ${row.deleted}, ${row.parentItem})`,
			`INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ('${row.key}', ${literal(
				row.tag,
			)})`,
		]),
		// A note that only ever existed as a draft has no published row, so the
		// lookup can never reach its lines.
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('AMBRRED7', 'native', 'AMBRRED7')`,
		`INSERT INTO "itemDraft" ("itemKey", "sourceConnectionKey", "patch") VALUES ('AMBRRED7', 'native', ${literal(
			JSON.stringify({
				itemType: "Note",
				note: `draft-only/2024 = ${REDIRECT_NOTE_DESTINATION}`,
			}),
		)}::jsonb)`,
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

async function readMeilisearchDocument(profile: Profile, key: string) {
	const response = await fetch(
		`http://127.0.0.1:${profile.meilisearchPort}/indexes/${profile.config.services.search.index}/documents/${key}`,
		{ headers: { Authorization: "Bearer acceptance-master-key" } },
	);
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(
			`${profile.name} Meilisearch document check failed: ${response.status} ${await response.text()}`,
		);
	}
	return (await response.json()) as { title?: unknown };
}

async function meilisearchHasDocument(profile: Profile, key: string) {
	return (await readMeilisearchDocument(profile, key)) !== null;
}

async function waitForIndexedItemTitle(
	profile: Profile,
	key: string,
	title: string,
) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if ((await readMeilisearchDocument(profile, key))?.title === title)
			return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		`Timed out waiting for ${profile.name} search to index ${key} as ${title}`,
	);
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
	const publicConfig = projectPublicLibraryConfig(config);
	const visibleNavigation = getVisibleRuntimeLinks(publicConfig.navigation.links);
	const externalNavigation = visibleNavigation.find((link) =>
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
		PLAYWRIGHT_SUBSCRIPTION_TOKEN: subscriptionToken,
		PLAYWRIGHT_EXPECTED_DIGEST_ID: digestEditionId,
		PLAYWRIGHT_EXPECTED_DIGEST_TITLE: digestTitle,
		PLAYWRIGHT_EXPECTED_CONFIG_REVISION: config.revision,
		PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT: config.updatedAt,
		PLAYWRIGHT_EXPECTED_COOKIE_LINK: getRuntimeLinkHref(config.legal.cookiePolicy, config.identity.baseUrl),
		PLAYWRIGHT_EXPECTED_TERMS_LINK: config.legal.termsOfService ? getRuntimeLinkHref(config.legal.termsOfService, config.identity.baseUrl) : "",
		PLAYWRIGHT_EXPECTED_IDENTITY_NAME: config.identity.name,
		PLAYWRIGHT_EXPECTED_IDENTITY_SHORT_NAME: config.identity.shortName,
		PLAYWRIGHT_EXPECTED_LOGO_URL:
			activeTheme === "dark"
				? config.identity.assets.logoDark
				: config.identity.assets.logoLight,
		PLAYWRIGHT_EXPECTED_LOGO_URLS: [
			config.identity.assets.logoDark,
			config.identity.assets.logoLight,
		].join("|"),
		// Every picture a library brings: its own logo, its institutions and
		// its funders. The logo measurement serves each of these a test shape.
		PLAYWRIGHT_EXPECTED_BRAND_ASSET_URLS: Array.from(
			new Set([
				config.identity.assets.logoDark,
				config.identity.assets.logoLight,
				...config.institutions
					.map((institution) => institution.logoUrl)
					.filter(Boolean),
				...config.footer.funders
					.map((funder) => funder.logoUrl)
					.filter(Boolean),
			]),
		).join("|"),
		PLAYWRIGHT_EXPECTED_FAVICON_URL: config.identity.assets.favicon,
		PLAYWRIGHT_EXPECTED_LOGO_STYLE_TOKEN: logoStyleToken ?? "",
		PLAYWRIGHT_EXPECTED_ACCENT_RGB: formatRgbChannels(
			parseHexColor(config.theme.colors.accent),
		),
		PLAYWRIGHT_EXPECTED_GOOGLE_FONT_FAMILIES: googleFonts.join("|"),
		PLAYWRIGHT_EXPECTED_LOADED_LOGO: "true",
		PLAYWRIGHT_EXPECTED_THEME_CLASS: activeTheme,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY: profile.name === "amber" ? "AMBR3456" : "INDG3456",
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_TITLE: `${searchItemPrefix} runtime evidence`,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY: databaseItemKey,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_TITLE: `${searchItemPrefix} database evidence`,
		PLAYWRIGHT_EXPECTED_SOURCE_CITATION_LABEL:
			profile.name === "amber" ? "OpenAlex acceptance citations" : "",
		PLAYWRIGHT_EXPECTED_SOURCE_CITATION_COUNT:
			profile.name === "amber" ? "37" : "",
		PLAYWRIGHT_EXPECTED_LIBRARY_CITATION_LABEL:
			messages.ui.libraryCitations,
		PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL:
			visibleNavigation[0]?.label ?? "",
		PLAYWRIGHT_EXPECTED_EXTERNAL_NAVIGATION_LABEL:
			externalNavigation?.label ?? "",
		PLAYWRIGHT_EXPECTED_FOOTER_SECTION:
			publicConfig.footer.sections.find((section) => getVisibleRuntimeLinks(section.links).length > 0)?.title ?? "",
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
		PLAYWRIGHT_EXPECTED_CONSENT_ACCEPT: messages.ui.cookieAccept,
		PLAYWRIGHT_EXPECTED_CONSENT_DECLINE: messages.ui.cookieDecline,
		PLAYWRIGHT_EXPECTED_CONSENT_TITLE: messages.ui.cookieConsentTitle,
		PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT: String(scopes.length),
		PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL:
			messages.scopes[defaultScope.key] ?? defaultScope.name,
		PLAYWRIGHT_EXPECTED_YEAR_FILTER: String(config.filters.years.enabled),
		PLAYWRIGHT_EXPECTED_AUTHOR_FILTER: String(config.features.authorFilter),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL:
			messages.ui[config.filters.institution.label] ??
			config.filters.institution.label,
		PLAYWRIGHT_EXPECTED_CITATIONS_ENABLED: String(config.citations.enabled),
		PLAYWRIGHT_EXPECTED_CITATION_URL: String(
			config.citations.showUrl && config.citations.enabled,
		),
		PLAYWRIGHT_EXPECTED_EMBEDDINGS: String(
			config.search.embedder !== null && config.features.relatedResources,
		),
		PLAYWRIGHT_EXPECTED_PUBLIC_BASE_URL: config.identity.baseUrl,
		PLAYWRIGHT_EXPECTED_COUNTRY_FACET: String(config.search.country),
		PLAYWRIGHT_EXPECTED_COUNTRY_MAP: String(config.features.countryFocus),
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
		PLAYWRIGHT_EXPECTED_CONSENT: String(analyticsCapabilities(config.analytics).analytics),
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
		PLAYWRIGHT_EMAIL_SENDER: config.contact.email ?? config.email.smtp.from ?? "",
	};
}

function browserSuiteRuns(profile: Profile) {
	const suites: Array<[label: string, files: string[], project: string]> = [
		[
			"smoke",
			[
				"tests/e2e/smoke.spec.ts",
				"tests/e2e/email-form.spec.ts",
				"tests/e2e/subscription.spec.ts",
				"tests/e2e/digest-loading.spec.ts",
				"tests/e2e/brand-logo.spec.ts",
			],
			"chromium",
		],
		["ai-chat", ["tests/e2e/ai-chat.spec.ts"], "chromium"],
		["consent-gate", ["tests/e2e/consent-gate.spec.ts"], "chromium"],
		["integrations", ["tests/e2e/runtime-integrations.spec.ts"], "chromium"],
		["mobile", ["tests/e2e/runtime-mobile.spec.ts"], "mobile-chromium"],
	];
	return suites.map(([suite, files, project]) => ({
		label: `${profile.name}-${suite}`,
		args: ["playwright", "test", ...files, "--project", project],
		environment: playwrightEnvironment(`${profile.name}-${suite}`, {
			...commandEnvironment,
			...publicExpectations(profile),
		}),
	}));
}

function runBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} runtime acceptance suite`);
	for (const suite of browserSuiteRuns(profile)) {
		run("npx", suite.args, suite.environment);
	}
}

async function runBrowserSuiteInBackground(profile: Profile) {
	console.log(`\nStarting ${profile.name} runtime acceptance suite in the background`);
	for (const suite of browserSuiteRuns(profile)) {
		await runInBackground(suite.label, "npx", suite.args, suite.environment);
	}
}

function runAdminBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} admin browser suite`);
	const adminWorkers =
		process.env.PLAYWRIGHT_ADMIN_WORKERS ??
		process.env.PLAYWRIGHT_WORKERS ??
		(process.env.CI ? undefined : "1");
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
		"tests/e2e/admin-brand-logo.spec.ts",
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
	await waitForIndexedItemTitle(
		profile,
		"PUBUIA23",
		"Amber DOI admin interface report — Edited",
	);
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
	const response = await fetch(
		`http://127.0.0.1:${profile.port}${pathname}`,
		{
			headers: { Authorization: `Bearer ${credential}` },
		},
	);
	return { body: (await response.json()) as T, response };
}

type OpenScholarInstitutionPage = {
	items: { count: number; name: string }[];
	nextCursor: string | null;
};

type OpenScholarCollectionPage = {
	items: {
		count: number;
		hasChildren: boolean;
		id: string;
		parentId: string | null;
		source: string;
		title: string;
	}[];
	nextCursor: string | null;
};

const COLLECTION_TREE_FIXTURE = {
	child: "CHLDC3L2",
	deleted: "D3LTC3L2",
	item: "C3L7T3M2",
	root: "R33TC3L2",
} as const;

function seedCollectionTree(profile: Profile) {
	const { child, deleted, item: itemKey, root } = COLLECTION_TREE_FIXTURE;
	postgresScalar(
		profile.name,
		[
			`INSERT INTO "collectionIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${root}', 'native', '${root}'), ('${child}', 'native', '${child}'), ('${deleted}', 'native', '${deleted}')`,
			`INSERT INTO "collection" ("key", "sourceConnectionKey", "sourceRecordKey", "name", "deleted", "sortOrder", "parentCollection") VALUES ('${root}', 'native', '${root}', 'Tree root', 0, 3000, NULL), ('${child}', 'native', '${child}', 'Tree child', 0, 3001, '${root}'), ('${deleted}', 'native', '${deleted}', 'Deleted collection', 1, 3002, NULL)`,
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${itemKey}', 'native', '${itemKey}')`,
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "deleted") VALUES ('${itemKey}', 'native', '${itemKey}', 'JournalArticle', 'Collection tree evidence', 0)`,
			`INSERT INTO "itemToCollection" ("itemKey", "collectionKey") VALUES ('${itemKey}', '${child}')`,
		].join("; "),
	);
}

function removeCollectionTree(profile: Profile) {
	const { child, deleted, item: itemKey, root } = COLLECTION_TREE_FIXTURE;
	postgresScalar(
		profile.name,
		[
			`DELETE FROM "item" WHERE key = '${itemKey}'`,
			`DELETE FROM "itemIdentity" WHERE key = '${itemKey}'`,
			`DELETE FROM "collection" WHERE key IN ('${child}', '${deleted}', '${root}')`,
			`DELETE FROM "collectionIdentity" WHERE key IN ('${child}', '${deleted}', '${root}')`,
		].join("; "),
	);
}

// Institutions the picker must page through. Zephyr is named by three records
// and Borough by two, so the count order and the name order differ. Authors'
// affiliations count too: every fixture's author shares one, the search
// fixture names Amber Institute, and the publication fixture's author adds
// Amber Institute again and Indigo College.
const INSTITUTION_FIXTURES = [
	{ institution: "Zephyr University", key: "ZEPHYRA2" },
	{ institution: "Zephyr University", key: "ZEPHYRA3" },
	{ institution: "Zephyr University", key: "ZEPHYRA4" },
	{ institution: "Borough College", key: "BRGHCLA2" },
	{ institution: "Borough College", key: "BRGHCLA3" },
] as const;

const INSTITUTIONS_BY_COUNT = [
	{ count: 5, name: "Unrelated author affiliation" },
	{ count: 3, name: "Amber Evidence Library" },
	{ count: 3, name: "Zephyr University" },
	{ count: 2, name: "Amber Institute" },
	{ count: 2, name: "Borough College" },
	{ count: 1, name: "Indigo College" },
];

const INSTITUTIONS_BY_NAME = [
	{ count: 3, name: "Amber Evidence Library" },
	{ count: 2, name: "Amber Institute" },
	{ count: 2, name: "Borough College" },
	{ count: 1, name: "Indigo College" },
	{ count: 5, name: "Unrelated author affiliation" },
	{ count: 3, name: "Zephyr University" },
];

function seedInstitutionRecords(profile: Profile) {
	const statements = INSTITUTION_FIXTURES.flatMap((fixture) => [
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${fixture.key}', 'native', '${fixture.key}')`,
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision", "date", "dateAdded", "deleted", "parentItem", "publisher", "creators") VALUES ('${fixture.key}', 'native', '${fixture.key}', 'Report', 'Institution paging evidence ${fixture.key}', 1, '2026', now(), 0, NULL, '${fixture.institution}', '[{"creatorType":"author","firstName":"Ines","lastName":"Seed","institutions":[{"display_name":"Unrelated author affiliation","country_code":"GB"}]}]'::jsonb)`,
	]);
	postgresScalar(profile.name, statements.join("; "));
}

function removeInstitutionRecords(profile: Profile) {
	const keys = INSTITUTION_FIXTURES.map(({ key }) => `'${key}'`).join(", ");
	postgresScalar(
		profile.name,
		`DELETE FROM "item" WHERE key IN (${keys}); DELETE FROM "itemIdentity" WHERE key IN (${keys})`,
	);
}

/** Every institution the endpoint returns when it is read one row at a time. */
async function pageThroughInstitutions(
	profile: Profile,
	sort: string,
	direction: string,
) {
	const seen: { count: number; name: string }[] = [];
	let cursor = "";
	for (let page = 0; page < INSTITUTIONS_BY_COUNT.length; page += 1) {
		const parameters = new URLSearchParams({
			direction,
			pageSize: "1",
			sort,
		});
		if (cursor) parameters.set("cursor", cursor);
		const answer = await openScholarRead<OpenScholarInstitutionPage>(
			profile,
			`/api/openscholar/institutions?${parameters.toString()}`,
		);
		assert.equal(answer.response.status, 200);
		assert.equal(
			answer.body.items.length,
			1,
			`page ${page + 1} of ${sort} ${direction} must hold exactly one institution`,
		);
		seen.push(...answer.body.items);
		if (!answer.body.nextCursor) return seen;
		cursor = answer.body.nextCursor;
	}
	throw new Error(
		`Paging ${sort} ${direction} still offered a cursor after ${INSTITUTIONS_BY_COUNT.length} pages`,
	);
}

async function verifyInstitutionCursorRules(profile: Profile) {
	const firstPage = await openScholarRead<OpenScholarInstitutionPage>(
		profile,
		"/api/openscholar/institutions?pageSize=1",
	);
	const cursor = encodeURIComponent(firstPage.body.nextCursor!);
	const mismatchBody = {
		error: {
			code: "validation_failed",
			fields: {
				cursor: "Search again to start from the first result.",
			},
			message:
				"The saved institution position does not match this search. Search again.",
		},
	};

	const otherSearch = await openScholarRead(
		profile,
		`/api/openscholar/institutions?pageSize=1&cursor=${cursor}&query=zephyr`,
	);
	assert.equal(otherSearch.response.status, 400);
	assert.deepEqual(otherSearch.body, mismatchBody);

	const otherSort = await openScholarRead(
		profile,
		`/api/openscholar/institutions?pageSize=1&cursor=${cursor}&sort=name`,
	);
	assert.equal(otherSort.response.status, 400);
	assert.deepEqual(otherSort.body, mismatchBody);

	const otherDirection = await openScholarRead(
		profile,
		`/api/openscholar/institutions?pageSize=1&cursor=${cursor}&direction=asc`,
	);
	assert.equal(otherDirection.response.status, 400);
	assert.deepEqual(otherDirection.body, mismatchBody);

	const unreadable = await openScholarRead(
		profile,
		"/api/openscholar/institutions?cursor=not-a-cursor",
	);
	assert.equal(unreadable.response.status, 400);
	assert.deepEqual(unreadable.body, {
		error: {
			code: "validation_failed",
			fields: {
				cursor: "Search again to start from the first result.",
			},
			message:
				"The saved institution position is invalid or expired. Search again.",
		},
	});
}

const LIFECYCLE_KEY = "LIFECYC2";
const LIFECYCLE_INSTITUTION = "Lifecycle Institute";

function institutionNamesFor(
	profile: Profile,
	key: string,
	source: "record" | "author" = "record",
) {
	return postgresScalar(
		profile.name,
		`SELECT coalesce(string_agg("institutionName", ', ' ORDER BY "institutionName"), '') FROM "itemInstitution" WHERE "itemKey" = '${key}' AND "source" = '${source}'`,
	);
}

function insertInstitutionRecord(
	profile: Profile,
	key: string,
	institution: string,
) {
	postgresScalar(
		profile.name,
		[
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${key}', 'native', '${key}')`,
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision", "date", "dateAdded", "deleted", "parentItem", "publisher", "creators") VALUES ('${key}', 'native', '${key}', 'Report', 'Institution evidence ${key}', 1, '2026', now(), 0, NULL, '${institution}', '[{"creatorType":"author","firstName":"Ines","lastName":"Seed","institutions":[{"display_name":"Unrelated author affiliation"}]}]'::jsonb)`,
		].join("; "),
	);
}

function removeInstitutionRecord(profile: Profile, key: string) {
	postgresScalar(
		profile.name,
		`DELETE FROM "itemDraft" WHERE "itemKey" = '${key}'; DELETE FROM "item" WHERE key = '${key}'; DELETE FROM "itemIdentity" WHERE key = '${key}'`,
	);
}

/**
 * The institution rows must follow the published record: a draft alone never
 * removes them, and a parent, a soft delete or a hard delete does.
 */
function verifyInstitutionProjectionLifecycle(profile: Profile) {
	console.log(`\nVerifying ${profile.name} institution projection lifecycle`);
	insertInstitutionRecord(profile, LIFECYCLE_KEY, LIFECYCLE_INSTITUTION);
	try {
		const change = (statement: string) =>
			postgresScalar(profile.name, statement);
		const names = () => institutionNamesFor(profile, LIFECYCLE_KEY);
		// The creator has a different affiliation. It is listed as the
		// author's and must not leak into the record's own institutions.
		assert.equal(names(), LIFECYCLE_INSTITUTION, "a new record is listed");
		change(
			`UPDATE "item" SET creators = '[{"creatorType":"author","firstName":"Ines","lastName":"Seed","institutions":[{"display_name":"Changed author affiliation"}]}]'::jsonb WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(
			names(),
			LIFECYCLE_INSTITUTION,
			"author affiliations do not change a record institution",
		);
		assert.equal(
			institutionNamesFor(profile, LIFECYCLE_KEY, "author"),
			"Changed author affiliation",
			"an author's affiliation is listed as the author's",
		);

		change(
			`INSERT INTO "itemDraft" ("itemKey", "sourceConnectionKey", "patch") VALUES ('${LIFECYCLE_KEY}', 'native', '{"parentItem": "AMBR2345"}'::jsonb)`,
		);
		assert.equal(
			names(),
			LIFECYCLE_INSTITUTION,
			"an unpublished draft must not remove the institutions",
		);

		change(
			`UPDATE "item" SET "parentItem" = 'AMBR2345' WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(names(), "", "a published child is not listed");
		change(
			`UPDATE "item" SET "parentItem" = NULL WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(
			names(),
			LIFECYCLE_INSTITUTION,
			"a record that becomes top-level is listed again",
		);

		change(`UPDATE "item" SET deleted = 1 WHERE key = '${LIFECYCLE_KEY}'`);
		assert.equal(names(), "", "a deleted record is not listed");
		change(`UPDATE "item" SET deleted = 0 WHERE key = '${LIFECYCLE_KEY}'`);
		assert.equal(
			names(),
			LIFECYCLE_INSTITUTION,
			"a restored record is listed again",
		);
		change(
			`UPDATE "item" SET publisher = 'Replacement Institute' WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(
			names(),
			"Replacement Institute",
			"the Zotero institution field is canonical",
		);
		change(
			`UPDATE "item" SET "itemType" = 'JournalArticle' WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(
			names(),
			"",
			"a publisher field is not an institution on other item types",
		);
		change(
			`UPDATE "item" SET "itemType" = 'Report', publisher = '${LIFECYCLE_INSTITUTION}' WHERE key = '${LIFECYCLE_KEY}'`,
		);
		assert.equal(
			names(),
			LIFECYCLE_INSTITUTION,
			"a report institution is restored",
		);

		change(
			`SELECT refresh_admin_item_list_projection('${LIFECYCLE_KEY}'); SELECT refresh_admin_item_list_projection('${LIFECYCLE_KEY}')`,
		);
		assert.equal(
			postgresScalar(
				profile.name,
				`SELECT count(*) FROM "itemInstitution" WHERE "itemKey" = '${LIFECYCLE_KEY}'`,
			),
			// The record's institution and the author's affiliation.
			"2",
			"refreshing twice must not duplicate a row",
		);
	} finally {
		removeInstitutionRecord(profile, LIFECYCLE_KEY);
	}
	assert.equal(
		institutionNamesFor(profile, LIFECYCLE_KEY),
		"",
		"a record deleted for good takes its institutions with it",
	);
}

/**
 * PostgreSQL folds the case of the search and of the stored name together, so
 * a name with a dotted capital I is found however it is typed.
 */
async function verifyNonAsciiInstitutionSearch(profile: Profile) {
	const institution = "İstanbul Üniversitesi";
	insertInstitutionRecord(profile, "ISTANBU2", institution);
	try {
		for (const query of ["istanbul", "İSTANBUL", "üniversitesi"]) {
			const found = await openScholarRead<OpenScholarInstitutionPage>(
				profile,
				`/api/openscholar/institutions?query=${encodeURIComponent(query)}`,
			);
			assert.deepEqual(
				found.body,
				{ items: [{ count: 1, name: institution }], nextCursor: null },
				`searching for ${query} must find ${institution}`,
			);
		}
	} finally {
		removeInstitutionRecord(profile, "ISTANBU2");
	}
}

/** The production query with its values written in, so EXPLAIN can read it. */
function explainableInstitutionQuery(query: string) {
	const request = parseOpenScholarInstitutionRequest(query ? { query } : {});
	const compiled = new PgDialect().sqlToQuery(
		buildInstitutionCountsQuery(request, null),
	);
	return compiled.sql.replace(
		/\$(\d+)/gu,
		(_placeholder, position: string) => {
			const value = compiled.params[Number(position) - 1];
			return typeof value === "number"
				? String(value)
				: `'${String(value).replace(/'/gu, "''")}'`;
		},
	);
}

/** The picker must never read the records themselves. */
function verifyInstitutionQueryPlans(profile: Profile) {
	const paged = postgresScalar(
		profile.name,
		`EXPLAIN ${explainableInstitutionQuery("")}`,
	);
	assert.ok(
		paged.includes("itemInstitution"),
		`the paged plan must read the projection:\n${paged}`,
	);
	assert.ok(
		!/\bon "?item"?\b/iu.test(paged) && !/jsonb/iu.test(paged),
		`the paged plan must not scan the records:\n${paged}`,
	);

	// The fixture is far too small for the planner to prefer any index, so this
	// second plan only shows that the search is eligible for the trigram index.
	const searched = postgresScalar(
		profile.name,
		`SET LOCAL enable_seqscan = off; SET LOCAL enable_indexscan = off; SET LOCAL enable_indexonlyscan = off; EXPLAIN ${explainableInstitutionQuery("zephyr")}`,
	);
	assert.ok(
		searched.includes("itemInstitution_name_search_idx"),
		`the search plan must be able to use the trigram index:\n${searched}`,
	);

	console.log(
		`Institution paged plan, production query, planner untouched: ${paged.split("\n").join(" | ")}\n` +
			`Institution search plan, production query, sequential scans off to show the index is eligible: ${searched.split("\n").join(" | ")}`,
	);
}

async function verifyOpenScholarInstitutions(profile: Profile) {
	const denied = await openScholarRead(
		profile,
		"/api/openscholar/institutions",
		acceptanceOpenScholar.indigo.machineCredential,
	);
	assert.equal(denied.response.status, 401);

	const institutions = await openScholarRead<OpenScholarInstitutionPage>(
		profile,
		"/api/openscholar/institutions",
	);
	assert.equal(institutions.response.status, 200);
	assert.equal(
		institutions.response.headers.get("cache-control"),
		"private, no-store",
	);
	assert.deepEqual(institutions.body, {
		items: INSTITUTIONS_BY_COUNT,
		nextCursor: null,
	});

	assert.deepEqual(
		await pageThroughInstitutions(profile, "count", "desc"),
		INSTITUTIONS_BY_COUNT,
		"paging by count must keep the order and repeat nothing",
	);
	assert.deepEqual(
		await pageThroughInstitutions(profile, "name", "asc"),
		INSTITUTIONS_BY_NAME,
		"paging by name must keep the order and repeat nothing",
	);
	assert.deepEqual(
		await pageThroughInstitutions(profile, "count", "asc"),
		[...INSTITUTIONS_BY_COUNT]
			.reverse()
			.sort((first, second) =>
				first.count === second.count
					? first.name.localeCompare(second.name)
					: first.count - second.count,
			),
		"paging by count upwards must keep the order and repeat nothing",
	);
	assert.deepEqual(
		await pageThroughInstitutions(profile, "name", "desc"),
		[...INSTITUTIONS_BY_NAME].reverse(),
		"paging by name backwards must keep the order and repeat nothing",
	);

	const searched = await openScholarRead<OpenScholarInstitutionPage>(
		profile,
		"/api/openscholar/institutions?query=AMBER%20EVIDENCE",
	);
	assert.deepEqual(searched.body, {
		items: [{ count: 3, name: "Amber Evidence Library" }],
		nextCursor: null,
	});

	await verifyInstitutionCursorRules(profile);
	verifyInstitutionQueryPlans(profile);
}

async function verifyOpenScholarReadApi(profile: Profile) {
	console.log(`\nVerifying ${profile.name} OpenScholar read API`);
	verifyInstitutionProjectionLifecycle(profile);
	await verifyNonAsciiInstitutionSearch(profile);
	seedInstitutionRecords(profile);
	try {
		await verifyOpenScholarInstitutions(profile);
	} finally {
		removeInstitutionRecords(profile);
	}

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

	// Saved link targets are named without opening the picker: the ids come
	// back in the order they were asked for and an id that no longer exists is
	// simply left out.
	const named = await openScholarRead<OpenScholarCollectionPage>(
		profile,
		"/api/openscholar/collections?ids=BBN8BK5J,ZZZZZZZZ,ZBJ4NBSL",
	);
	assert.equal(named.response.status, 200);
	assert.deepEqual(
		named.body.items.map(({ id, title }) => [id, title]),
		[
			["BBN8BK5J", "Amber theme collection"],
			["ZBJ4NBSL", "Amber source collection"],
		],
	);
	assert.equal(named.body.nextCursor, null);
	assert.equal(
		named.body.items.find(({ id }) => id === "ZBJ4NBSL")?.count,
		1,
		"a named collection carries its record count",
	);

	const idsWithSearch = await openScholarRead(
		profile,
		"/api/openscholar/collections?ids=ZBJ4NBSL&query=source",
	);
	assert.equal(idsWithSearch.response.status, 400);

	const search = await openScholarRead<OpenScholarCollectionPage>(
		profile,
		"/api/openscholar/collections?query=source",
	);
	assert.equal(search.response.status, 200);
	assert.equal(search.body.nextCursor, null);
	assert.deepEqual(
		search.body.items.map(({ count, hasChildren, id, parentId, title }) => ({
			count, hasChildren, id, parentId, title,
		})),
		[
			{
				count: 1,
				hasChildren: false,
				id: "ZBJ4NBSL",
				parentId: null,
				title: "Amber source collection",
			},
		],
	);
	assert.match(search.body.items[0].source, /native/i);

	seedCollectionTree(profile);
	try {
		const tree = await openScholarRead<OpenScholarCollectionPage>(
			profile,
			`/api/openscholar/collections?ids=${COLLECTION_TREE_FIXTURE.root},${COLLECTION_TREE_FIXTURE.child},${COLLECTION_TREE_FIXTURE.deleted}`,
		);
		assert.equal(tree.response.status, 200);
		assert.deepEqual(
			tree.body.items.map(({ count, hasChildren, id }) => ({
				count,
				hasChildren,
				id,
			})),
			[
				{
					count: 1,
					hasChildren: true,
					id: COLLECTION_TREE_FIXTURE.root,
				},
				{
					count: 1,
					hasChildren: false,
					id: COLLECTION_TREE_FIXTURE.child,
				},
			],
			"collection reads exclude deleted rows, include descendant records, and say which rows have a live child",
		);
	} finally {
		removeCollectionTree(profile);
	}
}

async function verifyOwnerLegalText(profile: Profile) {
	console.log(`\nVerifying ${profile.name} owner-written terms page`);
	const response = await fetch(
		`http://127.0.0.1:${profile.port}/${profile.config.localization.defaultLocale}/terms`,
	);
	assert.equal(response.status, 200);
	const html = await response.text();
	const renderedText = html
		.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
		.replace(/<[^>]*>/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	const siteHost = new URL(profile.config.identity.baseUrl).host;
	assert.ok(
		renderedText.includes(`Use ${siteHost} for research and teaching.`),
		"terms page must show the owner's text with the site host filled in",
	);
	assert.ok(
		renderedText.includes("Updated 01 August 2026"),
		"terms page must read the date from the owner's text",
	);
}

async function firstHopForPath(profile: Profile, pathname: string) {
	const origin = `http://127.0.0.1:${profile.port}`;
	const response = await fetch(`${origin}${pathname}`, {
		redirect: "manual",
	});
	const location = response.headers.get("location");

	return {
		status: response.status,
		pathname: location ? new URL(location, origin).pathname : null,
	};
}

async function readRedirectLookup(profile: Profile, lookupPath: string) {
	const response = await fetch(
		`http://127.0.0.1:${profile.port}/api/redirects/${lookupPath}`,
	);
	assert.equal(
		response.status,
		200,
		"the redirect lookup must answer, not fail",
	);

	return response.json();
}

async function verifyNoteRedirects(profile: Profile) {
	console.log(`\nVerifying ${profile.name} owner-written redirects`);

	// This runs the real query against PostgreSQL. A broken query answers 500
	// and the proxy quietly gives up, so read the answer directly first.
	assert.deepEqual(await readRedirectLookup(profile, "old-report/2024"), {
		destination: REDIRECT_NOTE_DESTINATION,
	});

	for (const pathname of [
		"/old-report/2024",
		`/${profile.config.localization.defaultLocale}/old-report/2024`,
		// A page below /terms belongs to the owner, even though /terms itself
		// is a page the library serves.
		"/terms/archive",
	]) {
		const moved = await firstHopForPath(profile, pathname);
		assert.equal(moved.status, 307, `${pathname} must move the reader`);
		assert.equal(
			moved.pathname,
			REDIRECT_NOTE_DESTINATION,
			`${pathname} must move the reader to the address in the note`,
		);
	}

	for (const [pathname, source] of [
		["/deleted-only/2024", "a deleted note"],
		["/draft-only/2024", "a note that was never published"],
		["/child-only/2024", "a child record"],
		["/Case-Only/2024", "a tag that differs only by capital letters"],
		["/injected-only/2024", "a tag shaped like a database attack"],
	] as const) {
		assert.deepEqual(
			await readRedirectLookup(profile, pathname.slice(1)),
			{ destination: null },
			`${source} must not create a redirect`,
		);
		// The live note must still answer right here. Together with the
		// separate addresses above, this shows the empty answer came from the
		// note being left out, not from the library reading some other note.
		assert.deepEqual(
			await readRedirectLookup(profile, "old-report/2024"),
			{ destination: REDIRECT_NOTE_DESTINATION },
			`the owner's own redirect must still work beside ${source}`,
		);
		const ignored = await firstHopForPath(profile, pathname);
		assert.equal(
			ignored.pathname,
			"/404",
			`${source} must end on the page-not-found screen`,
		);
	}

	// An address shaped like a database attack must be answered, not crash.
	const hostilePath = encodeURIComponent(`'; DROP TABLE "item"; --`);
	assert.deepEqual(await readRedirectLookup(profile, hostilePath), {
		destination: null,
	});

	// The library still reads its redirect list afterwards, so nothing was
	// damaged.
	assert.deepEqual(await readRedirectLookup(profile, "old-report/2024"), {
		destination: REDIRECT_NOTE_DESTINATION,
	});
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
	init: RequestInit = {},
) {
	const response = await fetch(
		`http://127.0.0.1:${profile.port}${pathname}`,
		{
			...init,
			headers: withAdminTestSession(session, init.headers),
		},
	);
	const body = await response.text();
	assert.equal(
		response.ok,
		true,
		`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${body}`,
	);
	return (response.status === 204 ? undefined : JSON.parse(body)) as T;
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

    await adminPublicationRequest(profile, session, `/api/admin/items/${removedFileKey}/file/removal`, {method: "POST"});
    assert.equal(postgresScalar("amber", `SELECT count(*) FROM "itemFilePublication" WHERE "parentItemKey" = '${itemKey}'`), "2", "Staging removal must leave the published PDFs available");
    const {review} = await adminPublicationRequest<{review: {id: string; revision: number}}>(profile, session, `/api/admin/items/${itemKey}/review`, {method: "POST"});
    await adminPublicationRequest(profile, session, `/api/admin/reviews/${review.id}`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action: "approve", expectedRevision: review.revision, zenodoFileChange: "minor_correction"}),
    });
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
	assert.ok(
		archive,
		"The local Zenodo fake did not retain the external DOI record",
	);
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

function cleanupAbandonedProjects() {
	const removedProjects = reapAbandonedProjects({ includePersistent: true });
	console.log(
		removedProjects === 0
			? "No abandoned acceptance projects found."
			: `Removed ${removedProjects} abandoned acceptance project${removedProjects === 1 ? "" : "s"}.`,
	);
}

function loadAcceptanceProfiles() {
	return [
		loadProfile("amber", amberPort, amberMeilisearchPort),
		loadProfile("indigo", indigoPort, indigoMeilisearchPort),
	];
}

function prepareAcceptanceRuntime(profiles: Profile[]) {
	rmSync(runtimeDirectory, { recursive: true, force: true });
	profiles.forEach(prepareRuntimeConfig);
}

function buildAcceptanceImage() {
	if (skipBuild) return;
	const previous = imageId(image);
	run("docker", [
		"buildx",
		"bake",
		"--file",
		"docker-bake.acceptance.hcl",
		"--load",
		"--set",
		`runtime.tags=${image}`,
		"acceptance",
	]);
	// The new build takes the tag and leaves the old image untagged. Nothing uses it again, and on the CI runner one
	// was left behind per run until the disk filled. A removal that fails (another tag still uses it) changes nothing.
	if (previous && previous !== imageId(image)) {
		spawnSync("docker", ["image", "rm", previous], { cwd: rootDirectory, env: commandEnvironment, stdio: "ignore" });
	}
}

function imageId(reference: string) {
	const result = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", reference], { cwd: rootDirectory, env: commandEnvironment, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : null;
}

async function startAcceptanceInfrastructure(profiles: Profile[]) {
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
	for (const profile of profiles) await seedSharedSearchIndexes(profile);
}

// The deployment Compose check starts its own library stack beside this one
// and only shares its database server, so it runs in a separate process while
// the acceptance stack starts and the Amber checks run.
function startRepositoryComposeCheck() {
	return runInBackground(
		"repository-compose",
		path.join(rootDirectory, "node_modules", ".bin", "tsx"),
		[fileURLToPath(import.meta.url), "--repository-compose"],
		{ ...commandEnvironment, EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT: composeProject },
	);
}

async function runRepositoryComposeCheck() {
	await initializeAcceptancePorts();
	const [amber] = loadAcceptanceProfiles();
	await verifyRepositoryComposeStartup(amber);
	await verifyBaseAcceptanceServicesSurvived();
}

async function startAcceptanceSearchWorkers(profiles: Profile[]) {
	compose(
		"up",
		"--wait",
		"--wait-timeout",
		"180",
		"amber-search-indexer",
		"indigo-search-indexer",
	);
	// Health passes once the index exists; the startup rebuild may still be
	// running, and the records seeded next must not race it.
	for (const profile of profiles) {
		const deadline = Date.now() + 180_000;
		while (
			postgresScalar(
				profile.name,
				`SELECT "searchIndexRebuildPending" FROM "status" WHERE "id" = 1`,
			) !== "f"
		) {
			if (Date.now() > deadline) {
				throw new Error(`${profile.name} search rebuild marker did not clear`);
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
}

async function seedAcceptanceRecords(profiles: Profile[]) {
	for (const profile of profiles) {
		postgresScalar(profile.name, `INSERT INTO "notificationSubscriber" ("email", "token", "digest", "instant", "confirmedAt", "confirmationExpiresAt") VALUES ('subscription@example.invalid', '${subscriptionToken}', true, true, now(), now() + interval '1 day')`);
		postgresScalar(profile.name, `INSERT INTO "notificationEdition" ("id", "stream", "windowStart", "windowEnd", "publications", "title", "summary", "markdown", "publishedAt", "nextAttemptAt") VALUES ('${digestEditionId}', 'digest', '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z', '[]', '${digestTitle}', 'A closer look at **reading routines** and classroom practice.', '## Classroom practice\n\nReading routines connect research with everyday teaching.', '2026-01-08T00:00:00Z', NULL)`);
		await seedSearch(profile);
		seedExportRecords(profile);
		seedRedirectNotes(profile);
	}
}

async function runAcceptanceBehavior(
	profiles: Profile[],
	repositoryCompose: Promise<void>,
) {
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
	// Counts collector requests, so it runs before anything else sends them.
	profiles.forEach(verifyServerAnalyticsTransport);
	// The Amber checks below touch only Amber. Indigo's suite shares the mail
	// catcher with Amber's suite, so it must finish before Amber's starts.
	const indigoSuite = runBrowserSuiteInBackground(profiles[1]);
	// Awaited below; a failure before then must not end the process.
	indigoSuite.catch(() => undefined);
	await verifyLiveConfigLifecycle(profiles[0]);
	await verifyPublicationLifecycle(profiles[0]);
	await verifyZenodoReuseExternalLifecycle(profiles[0]);
	await verifyPublicationAdminInterface(profiles[0]);
	await verifyOpenScholarReadApi(profiles[0]);
	await verifyOwnerLegalText(profiles[0]);
	await verifyNoteRedirects(profiles[0]);
	await indigoSuite;
	runBrowserSuite(profiles[0]);
	runAdminBrowserSuite(profiles[0]);
	await repositoryCompose;
	verifyJunitReports();
	cleanupAcceptanceUsers();
}

function reportAcceptanceSuccess() {
	console.log("\nRuntime acceptance passed for Amber and Indigo.");
	if (!keepRunning) return;
	console.log(
		`Amber: http://127.0.0.1:${amberPort}\nIndigo: http://127.0.0.1:${indigoPort}\nCompose project: ${composeProject}`,
	);
}

function reportAcceptanceFailure(error: unknown): never {
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
}

function cleanupAcceptanceRuntime() {
	if (keepRunning) return;
	// A stopped Compose check can leave its stack on this project's network.
	removeLibraryComposeProject(libraryComposeProject);
	compose("down", "--volumes", "--remove-orphans");
	rmSync(runtimeDirectory, { recursive: true, force: true });
}

async function runAcceptance() {
	await initializeAcceptancePorts();
	reapAbandonedProjects();
	const profiles = loadAcceptanceProfiles();
	prepareAcceptanceRuntime(profiles);
	try {
		buildAcceptanceImage();
		await startAcceptanceInfrastructure(profiles);
		const repositoryCompose = startRepositoryComposeCheck();
		await startAcceptanceSearchWorkers(profiles);
		await seedAcceptanceRecords(profiles);
		await runAcceptanceBehavior(profiles, repositoryCompose);
		reportAcceptanceSuccess();
	} catch (error) {
		await stopRunsInBackground();
		reportAcceptanceFailure(error);
	} finally {
		cleanupAcceptanceRuntime();
	}
}

async function main() {
	if (cleanupOnly) return cleanupAbandonedProjects();
	if (repositoryComposeOnly) return runRepositoryComposeCheck();
	await runAcceptance();
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
