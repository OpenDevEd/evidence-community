export const LIBRARY_COMPOSE_SERVICES = [
	"web",
	"search-indexer",
	"source-sync",
	"source-writeback",
	"publication-worker",
	"meilisearch",
] as const;

export type LibraryComposeService = (typeof LIBRARY_COMPOSE_SERVICES)[number];

const LIBRARY_COMPOSE_HEALTHY_SERVICES = [
	"web",
	"search-indexer",
	"publication-worker",
	"meilisearch",
] as const satisfies readonly LibraryComposeService[];

export const LIBRARY_COMPOSE_RELEASE_LABEL =
	"org.opendeved.evidence-library.release";

export type LibraryComposeProcess = {
	health: string | null;
	service: string;
	state: string;
};

export type LibraryComposePublishedPort = {
	containerPort: number;
	hostIp: string;
	hostPort: number;
	protocol: "sctp" | "tcp" | "udp";
};

export type LibraryComposeContainerFact = LibraryComposeProcess & {
	labels: Readonly<Record<string, string>>;
	publishedPorts: readonly LibraryComposePublishedPort[];
};

export type LibraryComposeContractErrorCode =
	| "duplicate_service"
	| "meilisearch_public_port"
	| "missing_service"
	| "release_mismatch"
	| "service_not_running"
	| "service_unhealthy"
	| "unexpected_service";

export class LibraryComposeContractError extends Error {
	readonly code: LibraryComposeContractErrorCode;
	readonly service?: LibraryComposeService;

	constructor(input: {
		code: LibraryComposeContractErrorCode;
		message: string;
		service?: LibraryComposeService;
	}) {
		super(input.message);
		this.name = "LibraryComposeContractError";
		this.code = input.code;
		this.service = input.service;
	}
}

const expectedServiceSet = new Set<string>(LIBRARY_COMPOSE_SERVICES);
const healthyServiceSet = new Set<string>(LIBRARY_COMPOSE_HEALTHY_SERVICES);

function serviceCountError(
	service: LibraryComposeService,
	count: number,
): LibraryComposeContractError {
	return new LibraryComposeContractError({
		code: count === 0 ? "missing_service" : "duplicate_service",
		message: `${service} must have one container.`,
		service,
	});
}

function requireOneService<T extends { service: string }>(
	items: readonly T[],
	service: LibraryComposeService,
) {
	const matches = items.filter((item) => item.service === service);
	if (matches.length !== 1) throw serviceCountError(service, matches.length);
	return matches[0];
}

function requireExactLibraryComposeServices(
	items: readonly { service: string }[],
) {
	if (items.some((item) => !expectedServiceSet.has(item.service))) {
		throw new LibraryComposeContractError({
			code: "unexpected_service",
			message: "The runtime contains an unexpected Compose service.",
		});
	}
	for (const service of LIBRARY_COMPOSE_SERVICES) {
		requireOneService(items, service);
	}
}

export function requireLibraryComposeServiceReadiness<
	T extends LibraryComposeProcess,
>(items: readonly T[]): T[] {
	return LIBRARY_COMPOSE_SERVICES.map((service) => {
		const item = requireOneService(items, service);
		if (item.state !== "running") {
			throw new LibraryComposeContractError({
				code: "service_not_running",
				message: `${service} must be running.`,
				service,
			});
		}
		if (healthyServiceSet.has(service) && item.health !== "healthy") {
			throw new LibraryComposeContractError({
				code: "service_unhealthy",
				message: `${service} must be healthy.`,
				service,
			});
		}
		return item;
	});
}

export function requireLibraryComposeRuntimeReadiness<
	T extends LibraryComposeContainerFact,
>(items: readonly T[], expectedCommit: string): T[] {
	requireExactLibraryComposeServices(items);
	const ready = requireLibraryComposeServiceReadiness(items);
	for (const item of ready) {
		if (item.labels[LIBRARY_COMPOSE_RELEASE_LABEL] !== expectedCommit) {
			throw new LibraryComposeContractError({
				code: "release_mismatch",
				message: `${item.service} must use the requested release.`,
				service: item.service as LibraryComposeService,
			});
		}
	}
	const meilisearch = ready.find((item) => item.service === "meilisearch");
	if (meilisearch?.publishedPorts.length) {
		throw new LibraryComposeContractError({
			code: "meilisearch_public_port",
			message: "Meilisearch must not publish a host port.",
			service: "meilisearch",
		});
	}
	return ready;
}
