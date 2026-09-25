import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LIBRARY_COMPOSE_SERVICES } from "../src/lib/deployment/library-compose-contract";

type ComposeService = {
	command?: string[];
	configs?: Array<{ source: string; target: string }>;
	depends_on?: Record<string, { condition?: string }>;
	entrypoint?: string[] | null;
	environment?: Record<string, string>;
	expose?: string[];
	healthcheck?: { start_period?: string; test?: string[] };
	image?: string;
	labels?: Record<string, string>;
	networks?: Record<string, { aliases?: string[] }>;
	ports?: unknown[];
	user?: string;
	volumes?: Array<{ source: string; target: string }>;
};

type ComposeModel = {
	configs?: Record<string, { content?: string }>;
	services?: Record<string, ComposeService>;
	networks?: Record<string, { external?: boolean; name?: string }>;
	volumes?: Record<string, unknown>;
};

type LibraryConfig = {
	services: {
		redis: { url: string };
		search: { host: string; key: string };
	};
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

function renderComposeFile(
	root: string,
	file: string,
	environment: Record<string, string>,
) {
	return JSON.parse(
		execFileSync(
			"docker",
			[
				"compose",
				"--project-directory",
				root,
				"-f",
				resolve(root, file),
				"config",
				"--format",
				"json",
			],
			{
				encoding: "utf8",
				env: { ...process.env, ...environment },
			},
		),
	) as ComposeModel;
}

function renderLibraryCompose(root: string, libraryConfig: LibraryConfig) {
	return renderComposeFile(root, "docker/compose.library.yaml", {
		LIBRARY_CONFIG_JSON: JSON.stringify(libraryConfig),
		MEILISEARCH_MASTER_KEY: libraryConfig.services.search.key,
		RUNTIME_IMAGE: runtimeImage,
		SOURCE_COMMIT: sourceCommit,
	});
}

function requireComposeService(
	model: ComposeModel,
	name: string,
	message: string,
) {
	const service = model.services?.[name];
	requireCondition(service, message);
	return service;
}

function requireProxyPermissions(environment: Record<string, string>) {
	const permissions = {
		CONTAINERS: "Runtime verifier must be able to read containers",
		IMAGES: "Runtime verifier must be able to read image digests",
		NETWORKS:
			"Runtime verifier must be able to connect continuity guard networks",
		POST: "Runtime verifier must be able to create and remove continuity guards",
	};
	for (const [permission, message] of Object.entries(permissions)) {
		requireCondition(environment[permission] === "1", message);
	}
}

function requireVerifierMounts(verifier: ComposeService) {
	for (const target of [
		"/data/evidence-library-runtime-guards",
		"/runtime/traefik-dynamic",
	]) {
		requireCondition(
			verifier.volumes?.some((volume) => volume.target === target),
			`Runtime verifier mount is missing: ${target}`,
		);
	}
}

function requireVerifierDockerAccess(model: ComposeModel) {
	const verifier = requireComposeService(
		model,
		"runtime-verifier",
		"Runtime verifier is missing",
	);
	const proxy = requireComposeService(
		model,
		"docker-socket-proxy",
		"Runtime verifier socket proxy is missing",
	);
	const environment = proxy.environment;
	requireCondition(environment, "Runtime verifier socket proxy is missing");
	requireProxyPermissions(environment);
	requireCondition(
		verifier.expose?.includes("3001"),
		"Runtime verifier maintenance port is missing",
	);
	requireVerifierMounts(verifier);
	requireCondition(
		verifier.user === "0:0" && verifier.entrypoint === null,
		"Runtime verifier must retain host write access",
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
		meilisearch.image === "getmeili/meilisearch:v1.54",
		"Meilisearch image must be pinned to v1.54",
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

function requireRedisImageAndPrivacy(redis: ComposeService) {
	requireCondition(
		redis.image === "redis:7.2-alpine",
		"Redis image must be pinned to 7.2 Alpine",
	);
	const ports = redis.ports ?? [];
	const exposedPorts = redis.expose ?? [];
	requireCondition(
		ports.length === 0 && exposedPorts.length === 0,
		"Redis must not publish or expose a port",
	);
}

function requireRedisMemoryLimit(redis: ComposeService) {
	const command = redis.command ?? [];
	const requiredMemoryArguments = [
		"--maxmemory",
		"128mb",
		"--maxmemory-policy",
		"noeviction",
	];
	requireCondition(
		requiredMemoryArguments.every((argument) => command.includes(argument)),
		"Redis must fail closed at its 128 MB memory ceiling",
	);
}

function requireRedisNetworkAndHealth(redis: ComposeService) {
	requireCondition(
		JSON.stringify(Object.keys(redis.networks ?? {}).sort()) ===
			JSON.stringify(["private"]),
		"Redis must join only the private application network",
	);
	requireCondition(
		redis.healthcheck?.test?.includes("redis-cli"),
		"Redis health check is missing",
	);
}

function requireRedisRuntime(
	services: Record<string, ComposeService>,
	libraryConfig: LibraryConfig,
) {
	const redis = services.redis;
	requireCondition(redis, "Private Redis service is missing");
	requireRedisImageAndPrivacy(redis);
	requireRedisMemoryLimit(redis);
	requireRedisNetworkAndHealth(redis);
	requireCondition(
		redis.networks?.private?.aliases?.includes(new URL(libraryConfig.services.redis.url).hostname),
		"Runtime Redis URL must use an explicit private-network alias",
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

function requireRuntimeConfig(name: string, service: ComposeService) {
	requireCondition(
		service.environment?.LIBRARY_CONFIG_PATH ===
			"/runtime/config/library.json",
		`${name} must use the shared runtime configuration`,
	);
	requireCondition(
		service.environment?.LIBRARY_CONFIG_SEED_PATH ===
			"/runtime/config-seed/library.json",
		`${name} must use the image configuration seed`,
	);
	requireCondition(
		service.configs?.some(
			(config) =>
				config.source === "library-config" &&
				config.target === "/runtime/config-seed/library.json",
		),
		`${name} must mount the runtime configuration seed`,
	);
	requireCondition(
		service.volumes?.some(
			(volume) =>
				volume.source === "library-config-data" &&
				volume.target === "/runtime/config",
		),
		`${name} must mount the writable runtime configuration`,
	);
}

function requireRuntimeNetwork(name: string, service: ComposeService) {
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

function requireRuntimeService(name: string, service: ComposeService) {
	requireCondition(service, `${name} service is missing`);
	requireCondition(
		service.image === runtimeImage,
		`${name} must use the requested runtime image`,
	);
	requireRuntimeConfig(name, service);
	requireRuntimeNetwork(name, service);
}

function requireRuntimeServices(services: Record<string, ComposeService>) {
	for (const name of LIBRARY_COMPOSE_SERVICES.filter(
		(name) => name !== "meilisearch" && name !== "redis",
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
	requireCondition(
		services.web.depends_on?.redis?.condition === "service_healthy",
		"Web must wait for private Redis",
	);
}

function requireRenderedConfig(model: ComposeModel, expected: LibraryConfig) {
	const content = model.configs?.["library-config"]?.content;
	requireCondition(content, "Rendered runtime configuration is missing");
	const renderedConfig = JSON.parse(content) as LibraryConfig;
	requireCondition(
		renderedConfig.services.search.host === "http://meilisearch:7700",
		"Rendered runtime search host must use the private Compose service",
	);
	requireCondition(
		renderedConfig.services.redis.url === expected.services.redis.url,
		"Rendered runtime Redis URL must preserve the configured private service",
	);
}

function requireNamedStorage(model: ComposeModel) {
	requireCondition(
		Boolean(model.volumes?.["library-config-data"]),
		"Named runtime configuration volume is missing",
	);
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
	const model = renderLibraryCompose(root, libraryConfig);
	const { serviceNames, services } = requireExpectedServices(model);
	requireMeilisearchRuntime(services, libraryConfig);
	requireMeilisearchPorts(services);
	requireMeilisearchNetwork(services);
	requireMeilisearchStorage(services);
	requireRedisRuntime(services, libraryConfig);
	requireSearchIndexer(services);
	requireRuntimeServices(services);
	requirePublicationAndWeb(services);
	requireRenderedConfig(model, libraryConfig);
	requireNamedStorage(model);
	requireCoolifyNetwork(model);
	requireVerifierDockerAccess(
		renderComposeFile(root, "docker/compose.runtime-verifier.yaml", {
			EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN: "compose-check",
		}),
	);

	console.log(
		JSON.stringify({
			meilisearch: "private",
			services: serviceNames,
			searchHost: libraryConfig.services.search.host,
		}),
	);
}

main();
