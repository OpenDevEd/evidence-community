import { createHash } from "node:crypto";

const POSTGRES_IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;
const MAX_LIBRARY_ID_BYTES = 256;
const MAX_LIBRARY_DATABASE_CREDENTIAL_BYTES = 1_024;
const LIBRARY_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type LibraryDatabaseAction = "create" | "normalize";
export type LibraryDatabaseOutcome = "created" | "matched" | "updated";

export type LibraryDatabaseProvisioningErrorCode =
	| "database_object_owner_conflict"
	| "database_owner_conflict"
	| "database_verification_failed"
	| "extension_owner_conflict"
	| "invalid_input"
	| "login_database_conflict"
	| "login_security_conflict";

export class LibraryDatabaseProvisioningError extends Error {
	readonly code: LibraryDatabaseProvisioningErrorCode;

	constructor(code: LibraryDatabaseProvisioningErrorCode, message: string) {
		super(message);
		this.name = "LibraryDatabaseProvisioningError";
		this.code = code;
	}
}

export type ExistingLibraryRoleSecurity = {
	canBypassRls: boolean;
	canCreateDatabase: boolean;
	canCreateRole: boolean;
	canReplicate: boolean;
	isSuperuser: boolean;
};

export function parseLibraryDatabaseName(value: string, label: string) {
	const byteLength = Buffer.byteLength(value, "utf8");
	if (
		!POSTGRES_IDENTIFIER_PATTERN.test(value) ||
		byteLength > MAX_POSTGRES_IDENTIFIER_BYTES
	) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			`${label} must use only lowercase letters, numbers, and underscores and must be 63 bytes or shorter.`,
		);
	}
	return value;
}

export function parseOpenScholarLibraryId(libraryId: string) {
	const byteLength = Buffer.byteLength(libraryId, "utf8");
	if (
		!libraryId ||
		libraryId !== libraryId.trim() ||
		byteLength > MAX_LIBRARY_ID_BYTES ||
		LIBRARY_ID_CONTROL_CHARACTER_PATTERN.test(libraryId)
	) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Library ID must be a non-empty string of at most 256 bytes without surrounding whitespace or control characters.",
		);
	}
	return libraryId;
}

export function deriveLibraryDatabaseNames(libraryId: string) {
	const parsedLibraryId = parseOpenScholarLibraryId(libraryId);
	const digest = createHash("sha256")
		.update(parsedLibraryId, "utf8")
		.digest("hex")
		.slice(0, 48);
	return {
		databaseName: `el_${digest}`,
		loginName: `el_${digest}_user`,
	};
}

export function parseLibraryDatabasePassword(password: string) {
	if (
		!password ||
		Buffer.byteLength(password, "utf8") >
			MAX_LIBRARY_DATABASE_CREDENTIAL_BYTES ||
		password.includes("\u0000")
	) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Login password must be a non-empty string of at most 1024 bytes without null characters.",
		);
	}
	return password;
}

export function parsePostgresAdminUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Administrator URL must be a PostgreSQL URL.",
		);
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Administrator URL must be a PostgreSQL URL.",
		);
	}
	if (!decodeURIComponent(url.username)) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Administrator URL must include a login name.",
		);
	}
	return url;
}

export function quotePostgresIdentifier(value: string) {
	const identifier = parseLibraryDatabaseName(value, "PostgreSQL identifier");
	return `"${identifier.replaceAll('"', '""')}"`;
}

export function validateLibraryDatabaseTarget(input: {
	adminUser: string;
	database: string;
	existingRole: ExistingLibraryRoleSecurity | null;
	user: string;
}) {
	if (
		input.database === "postgres" ||
		input.database.startsWith("template")
	) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			`The database name ${input.database} is reserved by PostgreSQL.`,
		);
	}
	if (
		input.user === "postgres" ||
		input.user.startsWith("pg_") ||
		input.user === input.adminUser
	) {
		throw new LibraryDatabaseProvisioningError(
			"login_security_conflict",
			`The login ${input.user} is protected and cannot be used by a library.`,
		);
	}
	const role = input.existingRole;
	if (
		role &&
		(role.isSuperuser ||
			role.canCreateDatabase ||
			role.canCreateRole ||
			role.canReplicate ||
			role.canBypassRls)
	) {
		throw new LibraryDatabaseProvisioningError(
			"login_security_conflict",
			`The login ${input.user} already has powerful server rights and will not be changed.`,
		);
	}
}

export function decideLibraryDatabaseAction(input: {
	existingOwner: string | null;
	requestedOwner: string;
}): LibraryDatabaseAction {
	if (input.existingOwner === null) return "create";
	if (input.existingOwner === input.requestedOwner) return "normalize";
	throw new LibraryDatabaseProvisioningError(
		"database_owner_conflict",
		`The database is owned by ${input.existingOwner}, not ${input.requestedOwner}.`,
	);
}

export function parseInternalPostgresHost(value: string) {
	if (!value || value.includes("/") || value.includes("@")) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Internal PostgreSQL host must be a hostname with an optional port.",
		);
	}

	let url: URL;
	try {
		url = new URL(`postgresql://${value}`);
	} catch {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Internal PostgreSQL host must be a hostname with an optional port.",
		);
	}

	const port = url.port ? Number(url.port) : null;
	if (
		!url.hostname ||
		url.username ||
		url.password ||
		url.pathname !== "" ||
		(port !== null &&
			(!Number.isInteger(port) || port < 1 || port > 65_535))
	) {
		throw new LibraryDatabaseProvisioningError(
			"invalid_input",
			"Internal PostgreSQL host must be a hostname with an optional port.",
		);
	}

	return { hostname: url.hostname, port: url.port };
}

export function buildLibraryDatabaseUrl(input: {
	database: string;
	host: string;
	password: string;
	user: string;
}) {
	const database = parseLibraryDatabaseName(input.database, "Database name");
	const user = parseLibraryDatabaseName(input.user, "Login name");
	const password = parseLibraryDatabasePassword(input.password);
	const host = parseInternalPostgresHost(input.host);

	const url = new URL("postgresql://placeholder");
	url.hostname = host.hostname;
	url.port = host.port;
	url.username = user;
	url.password = password;
	url.pathname = `/${database}`;
	return url.toString();
}
