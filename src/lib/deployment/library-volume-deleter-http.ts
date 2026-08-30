import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import { isCoolifyApplicationUuid } from "./coolify-application";
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

const deletePath = "/v1/library-volumes/delete";
const maximumBodyBytes = 4 * 1_024;

export type LibraryVolumeDeletionCode =
	| "volume_deletion_failed"
	| "volume_in_use";

export type LibraryVolumeDeletionResult = {
	outcome: "absent" | "deleted";
};

export type LibraryVolumeHttpDeleter = (
	applicationUuid: string,
) => Promise<LibraryVolumeDeletionResult>;

const deletionErrors: Record<
	LibraryVolumeDeletionCode,
	{ message: string; status: number }
> = {
	volume_deletion_failed: {
		message: "The library volume could not be deleted.",
		status: 502,
	},
	volume_in_use: {
		message: "The library volume is still in use.",
		status: 409,
	},
};

export class LibraryVolumeDeletionError extends Error {
	readonly code: LibraryVolumeDeletionCode;

	constructor(code: LibraryVolumeDeletionCode) {
		super(deletionErrors[code].message);
		this.name = "LibraryVolumeDeletionError";
		this.code = code;
	}
}

type VolumeDeleterServerOptions = {
	onError?: (error: unknown) => void;
	remove: LibraryVolumeHttpDeleter;
	token: string;
};

function requireKnownPath(url: URL) {
	if (!url.search && ["/health", deletePath].includes(url.pathname)) return;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

function parseDeleteRequest(serialized: string) {
	const body = parseJson(serialized);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return invalidRequest("Send only applicationUuid.");
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).join(",") !== "applicationUuid") {
		return invalidRequest("Send only applicationUuid.");
	}
	if (!isCoolifyApplicationUuid(record.applicationUuid)) {
		return invalidRequest(
			"applicationUuid must be a 24-character lowercase Coolify UUID.",
		);
	}
	return record.applicationUuid;
}

function sendDeletionError(
	response: ServerResponse,
	error: unknown,
	onError: (error: unknown) => void,
) {
	if (error instanceof LibraryVolumeDeletionError) {
		const contract = deletionErrors[error.code];
		sendJson(response, contract.status, {
			error: { code: error.code, message: contract.message },
		});
		return;
	}
	onError(error);
	const contract = deletionErrors.volume_deletion_failed;
	sendJson(response, contract.status, {
		error: {
			code: "volume_deletion_failed",
			message: contract.message,
		},
	});
}

async function handleDeleteRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<VolumeDeleterServerOptions>,
) {
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const applicationUuid = parseDeleteRequest(
		await readBoundedBody(request, maximumBodyBytes),
	);
	try {
		const result = await options.remove(applicationUuid);
		sendJson(response, 200, { applicationUuid, ...result });
	} catch (error: unknown) {
		sendDeletionError(response, error, options.onError);
	}
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<VolumeDeleterServerOptions>,
) {
	const url = new URL(request.url ?? "/", "http://localhost");
	requireKnownPath(url);
	if (url.pathname === "/health") {
		sendHealthResponse(request, response);
		return;
	}
	await handleDeleteRequest(request, response, options);
}

export function createLibraryVolumeDeleterServer(
	options: VolumeDeleterServerOptions,
): Server {
	const tokenBytes = Buffer.byteLength(options.token, "utf8");
	if (tokenBytes < 32 || tokenBytes > 1_024) {
		throw new Error("The volume deleter token must be 32 to 1024 bytes.");
	}
	const resolved: Required<VolumeDeleterServerOptions> = {
		onError: options.onError ?? (() => undefined),
		remove: options.remove,
		token: options.token,
	};
	return createFixedJsonHttpServer({
		handleRequest: (request, response) =>
			handleRequest(request, response, resolved),
		onInternalError: resolved.onError,
	});
}
