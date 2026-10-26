import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import {
	createFixedJsonHttpServer,
	HttpContractError,
	invalidRequest,
	parseJson,
	readBoundedBody,
	requireAuthorization,
	requireJsonContentType,
	requireMethod,
	sendHealthResponse,
	sendJson,
} from "./fixed-json-http";
import {
	LibraryDatabaseProvisioningError,
	parseLibraryDatabasePassword,
	parseOpenScholarLibraryId,
} from "./library-database";
import type {
	LibrarySearchDeletionResult,
	LibrarySearchReconciliationResult,
} from "./library-search";
import type {
	LibraryDatabaseDeletionResult,
	LibraryDatabaseReconciliationResult,
} from "./provision-library-database";

const reconcilePath = "/v1/library-databases/reconcile";
const deletePath = "/v1/library-databases/delete";
const searchReconcilePath = "/v1/library-search/reconcile";
const searchDeletePath = "/v1/library-search/delete";
const maximumBodyBytes = 16 * 1_024;

type ReconcileRequest = {
	libraryId: string;
	password: string;
};

export type LibraryDatabaseHttpReconciler = (
	request: ReconcileRequest,
) => Promise<LibraryDatabaseReconciliationResult>;

export type LibraryDatabaseHttpDeleter = (request: {
	libraryId: string;
}) => Promise<LibraryDatabaseDeletionResult>;

export type LibrarySearchHttpReconciler = (
	request: ReconcileRequest,
) => Promise<LibrarySearchReconciliationResult>;

type LibrarySearchHttpDeleter = (request: {
	libraryId: string;
}) => Promise<LibrarySearchDeletionResult>;

type ProvisionerServerOptions = {
	onError?: (error: unknown) => void;
	reconcile: LibraryDatabaseHttpReconciler;
	remove: LibraryDatabaseHttpDeleter;
	reconcileSearch: LibrarySearchHttpReconciler;
	removeSearch: LibrarySearchHttpDeleter;
	token: string;
};

function requireRequestRecord(body: unknown) {
	if (!body) return invalidRequest("Send only libraryId and password.");
	if (typeof body !== "object") {
		return invalidRequest("Send only libraryId and password.");
	}
	if (Array.isArray(body)) {
		return invalidRequest("Send only libraryId and password.");
	}
	return body as Record<string, unknown>;
}

function requireExactFields(record: Record<string, unknown>) {
	if (Object.keys(record).sort().join(",") !== "libraryId,password") {
		invalidRequest("Send only libraryId and password.");
	}
	return record;
}

function requireLibraryId(value: unknown) {
	const message =
		"libraryId must be a non-empty string of at most 256 bytes.";
	if (typeof value !== "string") return invalidRequest(message);
	try {
		return parseOpenScholarLibraryId(value);
	} catch {
		return invalidRequest(message);
	}
}

function requirePassword(value: unknown) {
	const message =
		"password must be a non-empty string of at most 1024 bytes.";
	if (typeof value !== "string") return invalidRequest(message);
	try {
		return parseLibraryDatabasePassword(value);
	} catch {
		return invalidRequest(message);
	}
}

function parseReconcileRequest(serialized: string): ReconcileRequest {
	const record = requireExactFields(
		requireRequestRecord(parseJson(serialized)),
	);
	return {
		libraryId: requireLibraryId(record.libraryId),
		password: requirePassword(record.password),
	};
}

function parseDeleteRequest(serialized: string) {
	const body = parseJson(serialized);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return invalidRequest("Send only libraryId.");
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).join(",") !== "libraryId") {
		return invalidRequest("Send only libraryId.");
	}
	return { libraryId: requireLibraryId(record.libraryId) };
}

const conflictMessages = {
	database_object_owner_conflict:
		"The library database contains objects owned by another login.",
	database_owner_conflict: "The library database is owned by another login.",
	extension_owner_conflict:
		"A required database extension is owned by another login.",
	login_database_conflict: "The library login owns another database.",
	login_security_conflict: "The library login has server-wide rights.",
} as const;

function sendReconciliationError(
	response: ServerResponse,
	error: unknown,
	onError: (error: unknown) => void,
) {
	onError(error);
	if (
		error instanceof LibraryDatabaseProvisioningError &&
		error.code in conflictMessages
	) {
		const code = error.code as keyof typeof conflictMessages;
		sendJson(response, 409, {
			error: { code, message: conflictMessages[code] },
		});
		return;
	}
	sendJson(response, 500, {
		error: {
			code: "database_reconciliation_failed",
			message: "The library database could not be reconciled.",
		},
	});
}

function sendSearchError(
	response: ServerResponse,
	error: unknown,
	onError: (error: unknown) => void,
) {
	onError(error);
	sendJson(response, 500, {
		error: {
			code: "search_reconciliation_failed",
			message: "The library search login could not be reconciled.",
		},
	});
}

type Route = {
	parse: (serialized: string) => ReconcileRequest | { libraryId: string };
	run: (options: Required<ProvisionerServerOptions>, body: never) => Promise<object>;
	fail: typeof sendReconciliationError;
};

const routes: Record<string, Route> = {
	[reconcilePath]: { parse: parseReconcileRequest, run: (options, body: ReconcileRequest) => options.reconcile(body), fail: sendReconciliationError },
	[deletePath]: { parse: parseDeleteRequest, run: (options, body: { libraryId: string }) => options.remove(body), fail: sendReconciliationError },
	[searchReconcilePath]: { parse: parseReconcileRequest, run: (options, body: ReconcileRequest) => options.reconcileSearch(body), fail: sendSearchError },
	[searchDeletePath]: { parse: parseDeleteRequest, run: (options, body: { libraryId: string }) => options.removeSearch(body), fail: sendSearchError },
};

function requireKnownPath(url: URL) {
	if (!url.search && (url.pathname === "/health" || url.pathname in routes)) return;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<ProvisionerServerOptions>,
) {
	const url = new URL(request.url ?? "/", "http://localhost");
	requireKnownPath(url);
	if (url.pathname === "/health") {
		sendHealthResponse(request, response);
		return;
	}
	const route = routes[url.pathname]!;
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const body = route.parse(await readBoundedBody(request, maximumBodyBytes));
	try {
		const result = await route.run(options, body as never);
		sendJson(response, 200, { libraryId: body.libraryId, ...result });
	} catch (error: unknown) {
		route.fail(response, error, options.onError);
	}
}

export function createLibraryDatabaseProvisionerServer(
	options: ProvisionerServerOptions,
): Server {
	if (Buffer.byteLength(options.token, "utf8") < 32) {
		throw new Error(
			"The database provisioner token must be at least 32 bytes.",
		);
	}
	const resolved: Required<ProvisionerServerOptions> = {
		onError: options.onError ?? ((error) => console.error(error)),
		reconcile: options.reconcile,
		remove: options.remove,
		reconcileSearch: options.reconcileSearch,
		removeSearch: options.removeSearch,
		token: options.token,
	};
	return createFixedJsonHttpServer({
		handleRequest: (request, response) =>
			handleRequest(request, response, resolved),
		onInternalError: resolved.onError,
	});
}
