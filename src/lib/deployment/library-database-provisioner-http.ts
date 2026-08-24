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
	sendJson,
} from "./fixed-json-http";
import {
	LibraryDatabaseProvisioningError,
	parseLibraryDatabasePassword,
	parseOpenScholarLibraryId,
} from "./library-database";
import type { LibraryDatabaseReconciliationResult } from "./provision-library-database";

const reconcilePath = "/v1/library-databases/reconcile";
const maximumBodyBytes = 16 * 1_024;

type ReconcileRequest = {
	libraryId: string;
	password: string;
};

export type LibraryDatabaseHttpReconciler = (
	request: ReconcileRequest,
) => Promise<LibraryDatabaseReconciliationResult>;

type ProvisionerServerOptions = {
	onError?: (error: unknown) => void;
	reconcile: LibraryDatabaseHttpReconciler;
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
	const record = requireExactFields(requireRequestRecord(parseJson(serialized)));
	return {
		libraryId: requireLibraryId(record.libraryId),
		password: requirePassword(record.password),
	};
}

const conflictMessages = {
	database_object_owner_conflict:
		"The library database contains objects owned by another login.",
	database_owner_conflict:
		"The library database is owned by another login.",
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

function requireKnownPath(url: URL) {
	if (!url.search && ["/health", reconcilePath].includes(url.pathname)) return;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

async function handleReconcileRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<ProvisionerServerOptions>,
) {
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const body = parseReconcileRequest(
		await readBoundedBody(request, maximumBodyBytes),
	);
	await runReconciliation(response, body, options);
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<ProvisionerServerOptions>,
) {
	const url = new URL(request.url ?? "/", "http://localhost");
	requireKnownPath(url);
	if (url.pathname === "/health") {
		requireMethod(request, "GET");
		sendJson(response, 200, { status: "ok" });
		return;
	}
	await handleReconcileRequest(request, response, options);
}

async function runReconciliation(
	response: ServerResponse,
	body: ReconcileRequest,
	options: Required<ProvisionerServerOptions>,
) {
	try {
		const result = await options.reconcile(body);
		sendJson(response, 200, { libraryId: body.libraryId, ...result });
	} catch (error: unknown) {
		sendReconciliationError(response, error, options.onError);
	}
}

export function createLibraryDatabaseProvisionerServer(
	options: ProvisionerServerOptions,
): Server {
	if (Buffer.byteLength(options.token, "utf8") < 32) {
		throw new Error("The database provisioner token must be at least 32 bytes.");
	}
	const resolved: Required<ProvisionerServerOptions> = {
		onError: options.onError ?? ((error) => console.error(error)),
		reconcile: options.reconcile,
		token: options.token,
	};
	return createFixedJsonHttpServer({
		handleRequest: (request, response) =>
			handleRequest(request, response, resolved),
		onInternalError: resolved.onError,
	});
}
