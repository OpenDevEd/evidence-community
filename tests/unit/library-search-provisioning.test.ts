import { describe, expect, it } from "vitest";

import {
	deleteLibrarySearch,
	deriveLibrarySearchName,
	LibrarySearchProvisioningError,
	librarySearchRole,
	parseSearchAdminUrl,
	parseSearchRuntimeHost,
	reconcileLibrarySearch,
} from "@/lib/deployment/library-search";

const adminUrl = "http://elastic:admin%20secret@search.internal:9200";
const runtimeHost = "http://elasticsearch:9200";
const libraryId = "j972k3h6k5k6x1m8v9z0";
const name = deriveLibrarySearchName(libraryId);

type FakeRequest = { method: string; path: string; body: unknown; authorization: string };
type FakeState = {
	roles: Map<string, unknown>;
	users: Map<string, { password: string; roles: string[] }>;
	indexes: Set<string>;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ADMIN = `Basic ${Buffer.from("elastic:admin secret").toString("base64")}`;

/** GET, PUT, and DELETE on one named security object (a role or a user). */
function securityObject<T>(objects: Map<string, T>, name: string, request: FakeRequest) {
	if (request.method === "GET") return objects.has(name) ? json(200, { [name]: objects.get(name) }) : json(404, {});
	if (request.method === "PUT") return objects.set(name, request.body as T), json(200, { created: true });
	return json(objects.delete(name) ? 200 : 404, {});
}

function authenticate(state: FakeState, request: FakeRequest) {
	const [user, password] = Buffer.from(request.authorization.replace("Basic ", ""), "base64").toString().split(":");
	return state.users.get(user!)?.password === password ? json(200, { username: user }) : json(401, {});
}

function resolveIndexes(state: FakeState, request: FakeRequest) {
	const patterns = decodeURIComponent(request.path.slice("/_resolve/index/".length)).split(",");
	const matches = (index: string, pattern: string) => (pattern.endsWith("*") ? index.startsWith(pattern.slice(0, -1)) : index === pattern);
	const found = [...state.indexes].filter((index) => patterns.some((pattern) => matches(index, pattern)));
	return json(200, { indices: found.map((index) => ({ name: index })), aliases: [] });
}

function deleteIndexes(state: FakeState, request: FakeRequest) {
	for (const index of request.path.slice(1).split(",")) state.indexes.delete(index);
	return json(200, { acknowledged: true });
}

/** The parts of Elasticsearch's security and index APIs the provisioner calls, kept in memory. */
function fakeElasticsearch() {
	const state: FakeState = { roles: new Map(), users: new Map(), indexes: new Set() };
	const route = (request: FakeRequest) => {
		if (request.path === "/_security/_authenticate") return authenticate(state, request);
		if (request.authorization !== ADMIN) return json(401, {});
		const [, area, kind, name] = request.path.split("/");
		if (area === "_security" && kind === "role") return securityObject(state.roles, name!, request);
		if (area === "_security" && kind === "user") return securityObject(state.users, name!, request);
		if (area === "_resolve") return resolveIndexes(state, request);
		return request.method === "DELETE" ? deleteIndexes(state, request) : json(500, {});
	};
	const fetch = (async (input: string | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		return route({
			method: init.method ?? "GET",
			path: url.pathname,
			body: init.body ? JSON.parse(String(init.body)) : undefined,
			authorization: new Headers(init.headers).get("authorization") ?? "",
		});
	}) as typeof globalThis.fetch;
	return { fetch, ...state };
}

describe("library search provisioning", () => {
	it("creates the library's login once, then matches it, and updates a changed password", async () => {
		const search = fakeElasticsearch();
		const reconcile = (password: string) => reconcileLibrarySearch({ adminUrl, fetch: search.fetch, libraryId, password, runtimeHost });

		expect(await reconcile("saved key")).toEqual({ outcome: "created", host: runtimeHost, index: name });
		expect(search.roles.get(name)).toEqual(librarySearchRole(name));
		expect(search.users.get(name)).toEqual({ password: "saved key", roles: [name] });

		expect(await reconcile("saved key")).toEqual({ outcome: "matched", host: runtimeHost, index: name });
		expect(await reconcile("rotated key")).toEqual({ outcome: "updated", host: runtimeHost, index: name });
		expect(search.users.get(name)!.password).toBe("rotated key");
	});

	it("puts back a role that was changed by hand", async () => {
		const search = fakeElasticsearch();
		await reconcileLibrarySearch({ adminUrl, fetch: search.fetch, libraryId, password: "saved key", runtimeHost });
		search.roles.set(name, { cluster: [], indices: [{ names: ["*"], privileges: ["all"] }] });

		expect(await reconcileLibrarySearch({ adminUrl, fetch: search.fetch, libraryId, password: "saved key", runtimeHost })).toMatchObject({ outcome: "updated" });
		expect(search.roles.get(name)).toEqual(librarySearchRole(name));
	});

	it("reaches only the library's alias and the indexes behind it", () => {
		expect(librarySearchRole(name).indices).toEqual([
			expect.objectContaining({ names: [name, `${name}_*`] }),
		]);
		expect(name).toBe(deriveLibrarySearchName(libraryId));
		expect(deriveLibrarySearchName("another library")).not.toBe(name);
	});

	it("deletes the library's indexes, login, and role, and then finds nothing", async () => {
		const search = fakeElasticsearch();
		await reconcileLibrarySearch({ adminUrl, fetch: search.fetch, libraryId, password: "saved key", runtimeHost });
		search.indexes.add(`${name}_1793000000000`);
		search.indexes.add(`${name}_1794000000000`);
		search.indexes.add("el_another_library_1");

		expect(await deleteLibrarySearch({ adminUrl, fetch: search.fetch, libraryId })).toEqual({
			outcome: "deleted",
			deletedIndexes: [`${name}_1793000000000`, `${name}_1794000000000`],
		});
		expect([...search.indexes]).toEqual(["el_another_library_1"]);
		expect(search.users.has(name) || search.roles.has(name)).toBe(false);
		expect(await deleteLibrarySearch({ adminUrl, fetch: search.fetch, libraryId })).toEqual({ outcome: "absent", deletedIndexes: [] });
	});

	it("reports a refusal without the passwords it holds", async () => {
		const refusing = (async () => new Response(JSON.stringify({ error: "cluster unavailable" }), { status: 503 })) as typeof fetch;
		const failure = reconcileLibrarySearch({ adminUrl, fetch: refusing, libraryId, password: "saved key", runtimeHost });

		await expect(failure).rejects.toBeInstanceOf(LibrarySearchProvisioningError);
		await expect(failure).rejects.toThrow(/refused to read the library role \(503\)/);
		await expect(failure).rejects.not.toThrow(/saved key|admin secret/);
	});

	it("accepts only an administrator URL with a login, and a runtime host without one", () => {
		expect(parseSearchAdminUrl(adminUrl)).toEqual({
			origin: "http://search.internal:9200",
			authorization: `Basic ${Buffer.from("elastic:admin secret").toString("base64")}`,
		});
		expect(() => parseSearchAdminUrl("http://search.internal:9200")).toThrow();
		expect(() => parseSearchAdminUrl("http://elastic:x@search.internal:9200/indexes")).toThrow();
		expect(parseSearchRuntimeHost("http://elasticsearch:9200")).toBe("http://elasticsearch:9200");
		expect(() => parseSearchRuntimeHost("http://elastic:x@elasticsearch:9200")).toThrow();
		expect(() => parseSearchRuntimeHost("elasticsearch:9200")).toThrow();
	});
});
