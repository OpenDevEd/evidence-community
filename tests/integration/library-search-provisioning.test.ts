import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";

import {
	deleteLibrarySearch,
	deriveLibrarySearchName,
	reconcileLibrarySearch,
} from "@/lib/deployment/library-search";

const ADMIN_PASSWORD = "integration-admin-password";
let origin: string;
let adminUrl: string;
let ownedContainer: string | undefined;

beforeAll(async () => {
	adminUrl = process.env.EVIDENCE_LIBRARY_TEST_ELASTICSEARCH_ADMIN_URL ?? "";
	if (!adminUrl) {
		ownedContainer = `library-search-${randomUUID()}`;
		// Take a port the machine reports free; rootless Docker daemons don't see each other's bindings.
		const probe = createServer().listen(0, "127.0.0.1");
		await once(probe, "listening");
		const { port } = probe.address() as AddressInfo;
		probe.close();
		execFileSync("docker", [
			"run", "--detach", "--rm", "--name", ownedContainer, "--publish", `127.0.0.1:${port}:9200`,
			"--env", "discovery.type=single-node", "--env", `ELASTIC_PASSWORD=${ADMIN_PASSWORD}`,
			"--env", "xpack.security.enabled=true", "--env", "xpack.security.http.ssl.enabled=false",
			"--env", "ES_JAVA_OPTS=-Xms512m -Xmx512m", "docker.elastic.co/elasticsearch/elasticsearch:9.5.5",
		]);
		adminUrl = `http://elastic:${ADMIN_PASSWORD}@127.0.0.1:${port}`;
	}
	const url = new URL(adminUrl);
	origin = url.origin;
	const password = decodeURIComponent(url.password);
	// Ready once the cluster answers yellow in time and the security index answers a lookup (404, not 503).
	await vi.waitFor(async () => {
		const health = await as("elastic", password, "GET", "/_cluster/health?wait_for_status=yellow&timeout=1s");
		expect(health.status === 200 && JSON.parse(health.body).timed_out === false).toBe(true);
		expect((await as("elastic", password, "GET", "/_security/role/readiness_probe")).status).toBe(404);
	}, { timeout: 120_000, interval: 1_000 });
}, 150_000);

afterAll(() => {
	if (ownedContainer) execFileSync("docker", ["rm", "--force", ownedContainer]);
}, 60_000);

/** One request to Elasticsearch as this login. */
async function as(user: string, password: string, method: string, path: string, body?: unknown) {
	const response = await fetch(`${origin}${path}`, {
		method,
		headers: {
			authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	}).catch(() => new Response(null, { status: 599 }));
	return { status: response.status, body: await response.text() };
}

it("gives each library a login that reaches only its own indexes, and deletes it all", async () => {
	const first = { libraryId: `library-${randomUUID()}`, password: "first library key" };
	const second = { libraryId: `library-${randomUUID()}`, password: "second library key" };
	const firstName = deriveLibrarySearchName(first.libraryId);
	const secondName = deriveLibrarySearchName(second.libraryId);
	const runtimeHost = "http://elasticsearch:9200";

	expect(await reconcileLibrarySearch({ adminUrl, runtimeHost, ...first })).toEqual({ outcome: "created", host: runtimeHost, index: firstName });
	expect(await reconcileLibrarySearch({ adminUrl, runtimeHost, ...first })).toMatchObject({ outcome: "matched" });
	await reconcileLibrarySearch({ adminUrl, runtimeHost, ...second });

	// The library's search worker creates an index behind its alias, fills it, and searches the alias.
	expect((await as(firstName, first.password, "PUT", `/${firstName}_1`, { aliases: { [firstName]: {} } })).status).toBe(200);
	expect((await as(firstName, first.password, "PUT", `/${firstName}/_doc/AAAA1111?refresh=wait_for`, { title: "kept" })).status).toBe(201);
	expect(JSON.parse((await as(firstName, first.password, "GET", `/${firstName}/_count`)).body).count).toBe(1);

	// Another library's login can't read, write, or make indexes there, nor anywhere outside its own names.
	expect((await as(secondName, second.password, "GET", `/${firstName}/_search`)).status).toBe(403);
	expect((await as(secondName, second.password, "PUT", `/${firstName}/_doc/BBBB2222`, { title: "stolen" })).status).toBe(403);
	expect((await as(secondName, second.password, "PUT", `/${firstName}_2`)).status).toBe(403);
	expect((await as(firstName, first.password, "PUT", "/unrelated_index")).status).toBe(403);
	expect((await as(firstName, "a wrong password", "GET", `/${firstName}/_count`)).status).toBe(401);

	expect(await deleteLibrarySearch({ adminUrl, libraryId: first.libraryId })).toEqual({ outcome: "deleted", deletedIndexes: [`${firstName}_1`] });
	expect((await as(firstName, first.password, "GET", "/_security/_authenticate")).status).toBe(401);
	const password = decodeURIComponent(new URL(adminUrl).password);
	expect((await as("elastic", password, "GET", `/${firstName}_1`)).status).toBe(404);
	expect(await deleteLibrarySearch({ adminUrl, libraryId: first.libraryId })).toEqual({ outcome: "absent", deletedIndexes: [] });
	await deleteLibrarySearch({ adminUrl, libraryId: second.libraryId });
}, 120_000);
