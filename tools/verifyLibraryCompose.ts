import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ComposeService = {
	command?: string[];
	configs?: Array<{ source: string; target: string }>;
	depends_on?: Record<string, { condition?: string }>;
	environment?: Record<string, string>;
	expose?: string[];
	healthcheck?: { start_period?: string; test?: string[] };
	image?: string;
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

function requireCondition(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) throw new Error(message);
}

function main() {
	const root = resolve(import.meta.dirname, "..");
	const libraryConfigJson = readFileSync(
		resolve(root, "config/library.example.json"),
		"utf8",
	);
	const libraryConfig = JSON.parse(libraryConfigJson) as {
		services: { search: { host: string; key: string } };
	};
	libraryConfig.services.search.host = "http://meilisearch:7700";
	const rendered = execFileSync(
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
			},
		},
	);
	const model = JSON.parse(rendered) as ComposeModel;
	const services = model.services ?? {};
	const serviceNames = Object.keys(services).sort();
	requireCondition(
		JSON.stringify(serviceNames) ===
			JSON.stringify([
				"meilisearch",
				"search-indexer",
				"source-sync",
				"source-writeback",
				"web",
			]),
		`Unexpected services: ${serviceNames.join(", ")}`,
	);

	const meilisearch = services.meilisearch;
	requireCondition(meilisearch, "Private Meilisearch service is missing");
	requireCondition(
		meilisearch.image === "getmeili/meilisearch:v1.37",
		"Meilisearch image must be pinned to v1.37",
	);
	requireCondition(
		meilisearch.environment?.MEILI_ENV === "production" &&
			meilisearch.environment.MEILI_NO_ANALYTICS === "true",
		"Meilisearch production settings are incomplete",
	);
	requireCondition(
		meilisearch.environment?.MEILI_MASTER_KEY ===
			libraryConfig.services.search.key,
		"Runtime search key and private Meilisearch key must match",
	);
	requireCondition(
		!meilisearch.ports?.length && !meilisearch.expose?.length,
		"Meilisearch must not publish or expose a port",
	);
	requireCondition(
		JSON.stringify(Object.keys(meilisearch.networks ?? {}).sort()) ===
			JSON.stringify(["private"]),
		"Meilisearch must join only the private application network",
	);
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

	for (const name of [
		"web",
		"search-indexer",
		"source-sync",
		"source-writeback",
	]) {
		const service = services[name];
		requireCondition(service, `${name} service is missing`);
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
	requireCondition(
		JSON.stringify(services.web.expose) === JSON.stringify(["3000"]),
		"Only the web service may expose port 3000",
	);
	const renderedConfig = JSON.parse(
		model.configs?.["library-config"]?.content ?? "null",
	) as { services?: { search?: { host?: string } } } | null;
	requireCondition(
		renderedConfig?.services?.search?.host === "http://meilisearch:7700",
		"Rendered runtime search host must use the private Compose service",
	);
	requireCondition(
		Boolean(model.volumes?.["meilisearch-data"]),
		"Named Meilisearch volume is missing",
	);
	requireCondition(
		model.networks?.coolify?.external === true &&
			model.networks.coolify.name === "coolify",
		"Shared PostgreSQL network must be the external Coolify network",
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
