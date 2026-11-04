import { Client, errors } from "@elastic/elasticsearch";

import { librarySearchRole, parseSearchAdminUrl } from "../../src/lib/deployment/library-search";

/** The shared Elasticsearch as its administrator, from a `http(s)://user:password@host:port` URL. */
export function elasticsearchAdmin(adminUrl: string) {
	const { origin } = parseSearchAdminUrl(adminUrl);
	const url = new URL(adminUrl);
	return new Client({
		node: origin,
		auth: { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) },
	});
}

/**
 * A test library's login, as the database provisioner creates one: named after the library's alias, with a role
 * that reaches only that alias and the indexes behind it.
 */
export async function createTestLibraryLogin(admin: Client, alias: string, password: string) {
	await admin.security.putRole({ name: alias, ...librarySearchRole(alias) });
	await admin.security.putUser({ username: alias, password, roles: [alias] });
}

/** An index behind `alias` that refuses every record for its content, for checks of the failure path. */
export async function createRefusingIndex(admin: Client, alias: string) {
	await admin.indices.create({
		index: `${alias}_1`,
		mappings: { dynamic: "strict", properties: {} },
		aliases: { [alias]: { is_write_index: true } },
	});
}

/** Deletes a test library's indexes, login, and role. */
export async function deleteTestLibrary(admin: Client, alias: string) {
	const resolved = await admin.indices.resolveIndex({ name: `${alias}_*` });
	const indexes = resolved.indices.map((index) => index.name);
	if (indexes.length > 0) await admin.indices.delete({ index: indexes });
	for (const remove of [() => admin.security.deleteUser({ username: alias }), () => admin.security.deleteRole({ name: alias })]) {
		await remove().catch((error: unknown) => {
			if (!(error instanceof errors.ResponseError && error.statusCode === 404)) throw error;
		});
	}
}

export async function readTestDocument<T>(admin: Client, alias: string, key: string) {
	return (await admin.get<T>({ index: alias, id: key }))._source as T;
}

export async function testDocumentMissing(admin: Client, alias: string, key: string) {
	try {
		await admin.get({ index: alias, id: key });
		return false;
	} catch (error) {
		if (error instanceof errors.ResponseError && error.statusCode === 404) return true;
		throw error;
	}
}
