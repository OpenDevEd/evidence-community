import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tailscaleImage =
	"tailscale/tailscale:v1.98.10@sha256:cdf5612ded5be1344f1a704b8c5e53496db97376bb533e5e15f141e48bf60cc0";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
	return isRecord(value) ? value : {};
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function mountedTargets(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry === "string") {
			return [entry.split(":")[1] ?? ""];
		}
		return isRecord(entry) && typeof entry.target === "string"
			? [entry.target]
			: [];
	});
}

function renderCompose(root: string): JsonRecord {
	const composeFile = path.join(
		root,
		"docker/compose.tailscale-development.yaml",
	);
	const result = spawnSync(
		"docker",
		[
			"compose",
			"--project-directory",
			root,
			"-f",
			composeFile,
			"config",
			"--format",
			"json",
		],
		{
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				LIBRARY_CONFIG_JSON: "{}",
				TAILSCALE_AUTHKEY: "test-only-compose-value",
			},
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`Docker Compose could not render the private deployment: ${result.stderr.trim()}`,
		);
	}
	return JSON.parse(result.stdout) as JsonRecord;
}

function check(
	errors: string[],
	condition: boolean,
	message: string,
): void {
	if (!condition) errors.push(message);
}

export function inspectTailscaleDevelopmentDeployment(
	root: string,
): string[] {
	const errors: string[] = [];
	const model = renderCompose(root);
	const services = record(model.services);
	const tailscale = record(services.tailscale);
	const web = record(services.web);
	const searchIndexer = record(services["search-indexer"]);

	check(
		errors,
		Object.keys(services).sort().join(",") ===
			"search-indexer,tailscale,web",
		"The private deployment must contain only Tailscale, web, and the search worker.",
	);
	for (const [name, service] of Object.entries(services)) {
		const definition = record(service);
		check(
			errors,
			!definition.ports,
			`${name} must not publish a host port.`,
		);
		const labels = record(definition.labels);
		check(
			errors,
			labels["traefik.enable"] === "false",
			`${name} must disable Traefik.`,
		);
		check(
			errors,
			!Object.keys(labels).some((label) =>
				label.startsWith("traefik.http.routers."),
			),
			`${name} must not define a public Traefik router.`,
		);
	}

	const tailscaleBuild = record(tailscale.build);
	check(errors, tailscaleBuild.context === root, "Tailscale must build from the repository root.");
	check(errors, tailscaleBuild.dockerfile === "ops/tailscale-development/Dockerfile", "Tailscale must use the repository-owned sidecar Dockerfile.");
	const tailscaleEnvironment = record(tailscale.environment);
	check(errors, tailscaleEnvironment.TS_AUTHKEY === "test-only-compose-value", "Coolify TAILSCALE_AUTHKEY must feed the container's TS_AUTHKEY.");
	check(errors, tailscaleEnvironment.TS_AUTH_ONCE === "true", "Tailscale must reuse its saved login.");
	check(errors, tailscaleEnvironment.TS_USERSPACE === "true", "Tailscale must run without host network privileges.");
	check(errors, tailscaleEnvironment.TS_STATE_DIR === "/var/lib/tailscale", "Tailscale must save its login in the persistent state directory.");
	check(errors, tailscaleEnvironment.TS_SERVE_CONFIG === "/config/serve.json", "Tailscale must load the repository Serve configuration.");
	const tailscaleTargets = mountedTargets(tailscale.volumes);
	check(errors, tailscaleTargets.includes("/var/lib/tailscale"), "Tailscale state must use a persistent volume.");
	check(errors, tailscaleTargets.includes("/config"), "The repository Serve directory must be mounted into Tailscale.");
	const tailscaleHealth = strings(record(tailscale.healthcheck).test).join(" ");
	check(errors, tailscaleHealth.includes("tailscale status --json"), "Tailscale health must check its tailnet connection.");
	check(errors, tailscaleHealth.includes("nc -z 127.0.0.1 3000"), "Tailscale health must check the loopback forwarder.");

	const dockerfile = readFileSync(
		path.join(root, "ops/tailscale-development/Dockerfile"),
		"utf8",
	);
	check(errors, dockerfile.includes(`FROM ${tailscaleImage}`), "The repository Tailscale image must use the pinned official base image.");
	check(errors, dockerfile.includes("apk add --no-cache socat=1.8.1.3-r0"), "The loopback forwarder package must be pinned.");
	const entrypoint = readFileSync(
		path.join(root, "ops/tailscale-development/entrypoint.sh"),
		"utf8",
	);
	check(errors, entrypoint.includes("TCP-LISTEN:3000,bind=127.0.0.1,reuseaddr,fork"), "The forwarder must listen only on loopback.");
	check(errors, entrypoint.includes("TCP:web:3000"), "The forwarder must target the private web service.");
	check(errors, entrypoint.includes("exec /usr/local/bin/containerboot"), "The sidecar must start Tailscale with its official container entrypoint.");

	const webEnvironment = record(web.environment);
	const webBuild = record(web.build);
	check(errors, webBuild.context === root, "Web must build from the repository root.");
	check(errors, webBuild.dockerfile === "Dockerfile", "Web must use the shared repository Dockerfile.");
	check(errors, webEnvironment.ADMIN_AUTH_BYPASS === "true", "The private web container must enable the existing admin bypass.");
	check(
		errors,
		!web.network_mode,
		"Web must use the private application network that Coolify manages.",
	);
	check(
		errors,
		strings(web.expose).includes("3000"),
		"Web must expose port 3000 only to the private application network.",
	);
	const dependencies = record(web.depends_on);
	check(errors, record(dependencies.tailscale).condition === "service_healthy", "Web must wait for Tailscale to be healthy.");
	check(errors, record(dependencies["search-indexer"]).condition === "service_healthy", "Web must wait for the search worker to be healthy.");
	const searchBuild = record(searchIndexer.build);
	check(errors, searchBuild.context === root, "The search worker must build from the repository root.");
	check(errors, searchBuild.dockerfile === "Dockerfile", "The search worker must use the shared repository Dockerfile.");
	check(errors, Boolean(searchIndexer.healthcheck), "The search worker must keep its real health check.");

	const servePath = path.join(root, "ops/tailscale-development/serve.json");
	const serve = JSON.parse(readFileSync(servePath, "utf8")) as JsonRecord;
	const tcp443 = record(record(serve.TCP)["443"]);
	const web443 = record(record(serve.Web)["${TS_CERT_DOMAIN}:443"]);
	const rootHandler = record(record(web443.Handlers)["/"]);
	check(errors, tcp443.HTTPS === true, "Tailscale Serve must provide private HTTPS on port 443.");
	check(errors, rootHandler.Proxy === "http://127.0.0.1:3000", "Tailscale Serve must proxy only to the supported loopback target.");
	check(errors, record(serve.AllowFunnel)["${TS_CERT_DOMAIN}:443"] === false, "Tailscale Funnel must stay disabled.");

	return errors;
}

function main(): void {
	const errors = inspectTailscaleDevelopmentDeployment(process.cwd());
	if (errors.length > 0) {
		for (const error of errors) console.error(`- ${error}`);
		process.exitCode = 1;
		return;
	}
	console.log("Tailscale development deployment contract passed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
