import { deriveLibraryDatabaseNames, parseLibraryDatabasePassword } from "./library-database";

/**
 * Each library's login on the shared Elasticsearch (OpenDevEd/new-el#718). The login and its role carry the name the
 * library's search alias has, and the role reaches only that alias and the indexes behind it (`<name>_*`), which the
 * library's search worker creates, fills, and swaps itself.
 */

export type LibrarySearchOutcome = "created" | "matched" | "updated";

export type LibrarySearchReconciliationResult = {
	outcome: LibrarySearchOutcome;
	host: string;
	index: string;
};

export type LibrarySearchDeletionResult = {
	outcome: "deleted" | "absent";
	deletedIndexes: string[];
};

export type LibrarySearchAdmin = {
	/** Where the provisioner reaches Elasticsearch, with the administrator login in the URL. */
	adminUrl: string;
	fetch?: typeof fetch;
};

export class LibrarySearchProvisioningError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "LibrarySearchProvisioningError";
	}
}

/** The alias, login, and role name for a library; the same name its PostgreSQL database has. */
export function deriveLibrarySearchName(libraryId: string) {
	return deriveLibraryDatabaseNames(libraryId).databaseName;
}

export function librarySearchRole(name: string) {
	// No cluster privileges: `monitor` would show every library's running searches (`/_tasks`) and index names
	// (`/_cluster/state`), and nothing the library runs needs it.
	return {
		cluster: [],
		indices: [
			{
				names: [name, `${name}_*`],
				privileges: ["create_index", "delete_index", "manage", "read", "write", "view_index_metadata"],
			},
		],
	};
}

/** The administrator URL without its login, and the login as a Basic authorization header. */
export function parseSearchAdminUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("The search administrator URL is not a URL.");
	}
	if (!["http:", "https:"].includes(url.protocol) || !url.username || !url.password || url.pathname !== "/" || url.search) {
		throw new Error("The search administrator URL must be http(s)://user:password@host:port with nothing after the port.");
	}
	const authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`;
	url.username = "";
	url.password = "";
	return { origin: url.origin, authorization };
}

/** Where a library's runtime reaches Elasticsearch: an internal http(s) origin, with no login or path. */
export function parseSearchRuntimeHost(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("The search runtime host must be an http(s) origin such as http://elasticsearch:9200.");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search) {
		throw new Error("The search runtime host must be an http(s) origin such as http://elasticsearch:9200.");
	}
	return url.origin;
}

function client({ adminUrl, fetch: fetchImpl = fetch }: LibrarySearchAdmin) {
	const { origin, authorization } = parseSearchAdminUrl(adminUrl);
	return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
		const response = await fetchImpl(`${origin}${path}`, {
			method,
			headers: { authorization, "content-type": "application/json", ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
	};
}

type SearchResponse = { status: number; body: unknown };
type SearchRequest = ReturnType<typeof client>;

function expectStatus(step: string, response: SearchResponse, allowed: readonly number[]) {
	if (allowed.includes(response.status)) return response;
	throw new LibrarySearchProvisioningError(
		response.status,
		`Elasticsearch refused to ${step} (${response.status}): ${JSON.stringify(response.body).slice(0, 500)}`,
	);
}

function basicAuthorization(user: string, password: string) {
	return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function sameRole(existing: unknown, wanted: ReturnType<typeof librarySearchRole>) {
	const sorted = (values: readonly string[] | undefined) => [...(values ?? [])].sort().join(",");
	const role = existing as { cluster?: string[]; indices?: Array<{ names?: string[]; privileges?: string[] }> } | undefined;
	const indices = role?.indices ?? [];
	return (
		sorted(role?.cluster) === sorted(wanted.cluster) &&
		indices.length === 1 &&
		sorted(indices[0]!.names) === sorted(wanted.indices[0]!.names) &&
		sorted(indices[0]!.privileges) === sorted(wanted.indices[0]!.privileges)
	);
}

/** Saves the library's role unless it already matches; answers whether it changed. */
async function reconcileRole(request: SearchRequest, name: string) {
	const wanted = librarySearchRole(name);
	const role = expectStatus("read the library role", await request("GET", `/_security/role/${name}`), [200, 404]);
	if (role.status === 200 && sameRole((role.body as Record<string, unknown>)[name], wanted)) return false;
	expectStatus("save the library role", await request("PUT", `/_security/role/${name}`, wanted), [200]);
	return true;
}

/** Whether the library's login is missing, holds exactly its role and this password, or needs saving again. */
async function loginState(request: SearchRequest, name: string, password: string) {
	const user = expectStatus("read the library login", await request("GET", `/_security/user/${name}`), [200, 404]);
	if (user.status === 404) return "missing";
	const roles = (user.body as Record<string, { roles?: string[] }>)[name]?.roles ?? [];
	const signedIn = expectStatus(
		"check the library login",
		await request("GET", "/_security/_authenticate", undefined, { authorization: basicAuthorization(name, password) }),
		[200, 401],
	);
	return roles.join(",") === name && signedIn.status === 200 ? "current" : "stale";
}

export async function reconcileLibrarySearch(
	input: LibrarySearchAdmin & { libraryId: string; password: string; runtimeHost: string },
): Promise<LibrarySearchReconciliationResult> {
	const name = deriveLibrarySearchName(input.libraryId);
	const password = parseLibraryDatabasePassword(input.password);
	const host = parseSearchRuntimeHost(input.runtimeHost);
	const request = client(input);
	const roleChanged = await reconcileRole(request, name);
	const login = await loginState(request, name, password);
	if (login !== "current") {
		// Saving the user sets both its role and its password; a running library keeps working once OpenScholar
		// activates the configuration that carries this password.
		expectStatus("save the library login", await request("PUT", `/_security/user/${name}`, { password, roles: [name] }), [200]);
	}
	const outcome: LibrarySearchOutcome = login === "missing" ? "created" : login === "stale" || roleChanged ? "updated" : "matched";
	return { outcome, host, index: name };
}

export async function deleteLibrarySearch(
	input: LibrarySearchAdmin & { libraryId: string },
): Promise<LibrarySearchDeletionResult> {
	const name = deriveLibrarySearchName(input.libraryId);
	const request = client(input);
	// The login goes first, so a worker still running can't make another index after its indexes are listed.
	const user = expectStatus("delete the library login", await request("DELETE", `/_security/user/${name}`), [200, 404]);
	const role = expectStatus("delete the library role", await request("DELETE", `/_security/role/${name}`), [200, 404]);
	// Wildcard deletes are refused by default, so the indexes are named one by one.
	const resolved = expectStatus(
		"list the library indexes",
		await request("GET", `/_resolve/index/${name},${name}_*?expand_wildcards=all&ignore_unavailable=true`),
		[200],
	);
	const deletedIndexes = ((resolved.body as { indices?: Array<{ name: string }> }).indices ?? []).map((index) => index.name).sort();
	if (deletedIndexes.length) {
		expectStatus("delete the library indexes", await request("DELETE", `/${deletedIndexes.join(",")}`), [200]);
	}
	const found = deletedIndexes.length > 0 || user.status === 200 || role.status === 200;
	return { outcome: found ? "deleted" : "absent", deletedIndexes };
}
