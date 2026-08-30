import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LIBRARY_COMPOSE_SERVICES } from "../src/lib/deployment/library-compose-contract";

type ComposeService = {
	command?: string[];
	configs?: Array<{ source: string; target: string }>;
	depends_on?: Record<string, { condition?: string }>;
	environment?: Record<string, string>;
	expose?: string[];
	healthcheck?: { start_period?: string; test?: string[] };
	image?: string;
	labels?: Record<string, string>;
	networks?: Record<string, unknown>;
	ports?: unknown[];
	volumes?: Array<{ source: string; target: string }>;
};

type ComposeModel = {
	configs?: Record<string, { content?: string }>;
	services?: Record<string, ComposeService>;
	networks?: Record<string, { external?: boolean; name?: string }>;
	volumes?: Record<string, unknown>;
};

type VerifierComposeModel = {
	services?: Record<string, ComposeService>;
};

type LibraryConfig = {
	services: { search: { host: string; key: string } };
};

const runtimeImage =
	"ghcr.io/opendeved/evidence-library-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceCommit = "a".repeat(40);

function requireCondition(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) throw new Error(message);
}

function loadLibraryConfig(root: string): LibraryConfig {
	const libraryConfigJson = readFileSync(
		resolve(root, "config/library.example.json"),
		"utf8",
	);
	const libraryConfig = JSON.parse(libraryConfigJson) as LibraryConfig;
	libraryConfig.services.search.host = "http://meilisearch:7700";
	return libraryConfig;
}

function renderCompose(root: string, libraryConfig: LibraryConfig) {
	return JSON.parse(
		execFileSync(
			"docker",
			[
				"compose",
				"--project-directory",
				root,
				"-f",
				resolve(root, "docker/compose.library.yaml"),
				"config",
				"--format",
				"json",
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					LIBRARY_CONFIG_JSON: JSON.stringify(libraryConfig),
					MEILISEARCH_MASTER_KEY: libraryConfig.services.search.key,
					RUNTIME_IMAGE: runtimeImage,
					SOURCE_COMMIT: sourceCommit,
				},
			},
		),
	) as ComposeModel;
}

function renderVerifierCompose(root: string) {
	return JSON.parse(
		execFileSync(
			"docker",
			[
				"compose",
				"--project-directory",
				root,
				"-f",
				resolve(root, "docker/compose.runtime-verifier.yaml"),
				"config",
				"--format",
				"json",
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN: "compose-check",
				},
			},
		),
	) as VerifierComposeModel;
}

function requireVerifierDockerReads(model: VerifierComposeModel) {
	const environment = model.services?.["docker-socket-proxy"]?.environment;
	requireCondition(environment, "Runtime verifier socket proxy is missing");
	requireCondition(
		environment.CONTAINERS === "1",
		"Runtime verifier must be able to read containers",
	);
	requireCondition(
		environment.IMAGES === "1",
		"Runtime verifier must be able to read image digests",
	);
	requireCondition(
		environment.POST === "0",
		"Runtime verifier must not write through the Docker API",
	);
}

function requireExpectedServices(model: ComposeModel) {
	const services = model.services ?? {};
	const serviceNames = Object.keys(services).sort();
	requireCondition(
		JSON.stringify(serviceNames) ===
			JSON.stringify([...LIBRARY_COMPOSE_SERVICES].sort()),
		`Unexpected services: ${serviceNames.join(", ")}`,
	);
	return { serviceNames, services };
}

function requireMeilisearchRuntime(
	services: Record<string, ComposeService>,
	libraryConfig: LibraryConfig,
) {
	const meilisearch = services.meilisearch;
	requireCondition(meilisearch, "Private Meilisearch service is missing");
	requireCondition(
		meilisearch.image === "getmeili/meilisearch:v1.37",
		"Meilisearch image must be pinned to v1.37",
	);
	requireCondition(
		meilisearch.environment?.MEILI_ENV === "production",
		"Meilisearch must run in production mode",
	);
	requireCondition(
		meilisearch.environment?.MEILI_NO_ANALYTICS === "true",
		"Meilisearch analytics must be disabled",
	);
	requireCondition(
		meilisearch.environment?.MEILI_MASTER_KEY ===
			libraryConfig.services.search.key,
		"Runtime search key and private Meilisearch key must match",
	);
}

function requireMeilisearchPorts(services: Record<string, ComposeService>) {
	const meilisearch = services.meilisearch;
	requireCondition(meilisearch, "Private Meilisearch service is missing");
	requireCondition(
		!meilisearch.ports?.length,
		"Meilisearch must not publish a port",
	);
	requireCondition(
		!meilisearch.expose?.length,
		"Meilisearch must not expose a port",
	);
}

function requireMeilisearchNetwork(services: Record<string, ComposeService>) {
	const meilisearch = services.meilisearch;
	requireCondition(meilisearch, "Private Meilisearch service is missing");
	requireCondition(
		JSON.stringify(Object.keys(meilisearch.networks ?? {}).sort()) ===
			JSON.stringify(["private"]),
		"Meilisearch must join only the private application network",
	);
}

function requireMeilisearchStorage(services: Record<string, ComposeService>) {
	const meilisearch = services.meilisearch;
	requireCondition(meilisearch, "Private Meilisearch service is missing");
	requireCondition(
		meilisearch.volumes?.some(
			(volume) =>
				volume.source === "meilisearch-data" &&
				volume.target === "/meili_data",
		),
		"Meilisearch must use its named data volume",
	);
	requireCondition(
		meilisearch.healthcheck?.test?.includes("http://127.0.0.1:7700/health"),
		"Meilisearch health check is missing",
	);
}

function requireSearchIndexer(services: Record<string, ComposeService>) {
	const searchIndexer = services["search-indexer"];
	requireCondition(searchIndexer, "Search indexer is missing");
	requireCondition(
		searchIndexer.depends_on?.meilisearch?.condition === "service_healthy",
		"Search indexer must wait for private Meilisearch",
	);
	requireCondition(
		searchIndexer.command
			?.at(-1)
			?.includes("runSearchIndexer.ts --watch") &&
			!searchIndexer.command?.at(-1)?.includes("--rebuild-if-missing"),
		"Search indexer must use the durable bootstrap before watching",
	);
	requireCondition(
		searchIndexer.healthcheck?.start_period === "1h0m0s",
		"Search indexer needs a one-hour first-rebuild health window",
	);
}

function requireRuntimeService(name: string, service: ComposeService) {
	requireCondition(service, `${name} service is missing`);
	requireCondition(
		service.image === runtimeImage,
		`${name} must use the requested runtime image`,
	);
	requireCondition(
		service.environment?.LIBRARY_CONFIG_PATH ===
			"/runtime/config/library.json",
		`${name} must use the shared runtime configuration`,
	);
	requireCondition(
		service.configs?.some(
			(config) =>
				config.source === "library-config" &&
				config.target === "/runtime/config/library.json",
		),
		`${name} must mount the shared runtime configuration`,
	);
	requireCondition(
		!service.ports?.length,
		`${name} must not publish a host port`,
	);
	requireCondition(
		JSON.stringify(Object.keys(service.networks ?? {}).sort()) ===
			JSON.stringify(["coolify", "private"]),
		`${name} must join the private and shared database networks`,
	);
}

function requireRuntimeServices(services: Record<string, ComposeService>) {
	for (const name of LIBRARY_COMPOSE_SERVICES.filter(
		(name) => name !== "meilisearch",
	)) {
		requireRuntimeService(name, services[name]);
	}
}

function requirePublicationAndWeb(services: Record<string, ComposeService>) {
	const publicationWorker = services["publication-worker"];
	requireCondition(
		publicationWorker?.depends_on?.["search-indexer"]?.condition ===
			"service_healthy",
		"Publication worker must wait for the search indexer",
	);
	requireCondition(
		publicationWorker?.healthcheck?.test?.includes(
			".next/publication/health.mjs",
		),
		"Publication worker health check is missing",
	);
	requireCondition(
		JSON.stringify(services.web.expose) === JSON.stringify(["3000"]),
		"Only the web service may expose port 3000",
	);
	requireCondition(
		services.web.labels?.["traefik.docker.network"] === "coolify",
		"The public proxy must reach web through the shared Coolify network",
	);
}

function requireRenderedConfig(model: ComposeModel) {
	const renderedConfig = JSON.parse(
		model.configs?.["library-config"]?.content ?? "null",
	) as { services?: { search?: { host?: string } } } | null;
	requireCondition(
		renderedConfig?.services?.search?.host === "http://meilisearch:7700",
		"Rendered runtime search host must use the private Compose service",
	);
}

function requireNamedStorage(model: ComposeModel) {
	requireCondition(
		Boolean(model.volumes?.["meilisearch-data"]),
		"Named Meilisearch volume is missing",
	);
}

function requireCoolifyNetwork(model: ComposeModel) {
	const coolify = model.networks?.coolify;
	requireCondition(coolify, "Shared Coolify network is missing");
	requireCondition(
		coolify.external === true,
		"Shared PostgreSQL network must be external",
	);
	requireCondition(
		coolify.name === "coolify",
		"Shared PostgreSQL network must use the Coolify network",
	);
}

function main() {
	const root = resolve(import.meta.dirname, "..");
	const libraryConfig = loadLibraryConfig(root);
	const model = renderCompose(root, libraryConfig);
	const { serviceNames, services } = requireExpectedServices(model);
	requireMeilisearchRuntime(services, libraryConfig);
	requireMeilisearchPorts(services);
	requireMeilisearchNetwork(services);
	requireMeilisearchStorage(services);
	requireSearchIndexer(services);
	requireRuntimeServices(services);
	requirePublicationAndWeb(services);
	requireRenderedConfig(model);
	requireNamedStorage(model);
	requireCoolifyNetwork(model);
	requireVerifierDockerReads(renderVerifierCompose(root));

	console.log(
		JSON.stringify({
			meilisearch: "private",
			services: serviceNames,
			searchHost: libraryConfig.services.search.host,
		}),
	);
}

main();
