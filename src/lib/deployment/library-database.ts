const POSTGRES_IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;

export type LibraryDatabaseAction = "create" | "normalize";

export function parseLibraryDatabaseName(value: string, label: string) {
	const byteLength = Buffer.byteLength(value, "utf8");
	if (
		!POSTGRES_IDENTIFIER_PATTERN.test(value) ||
		byteLength > MAX_POSTGRES_IDENTIFIER_BYTES
	) {
		throw new Error(
			`${label} must use only lowercase letters, numbers, and underscores and must be 63 bytes or shorter.`,
		);
	}
	return value;
}

export function quotePostgresIdentifier(value: string) {
	const identifier = parseLibraryDatabaseName(value, "PostgreSQL identifier");
	return `"${identifier.replaceAll('"', '""')}"`;
}

export function decideLibraryDatabaseAction(input: {
	existingOwner: string | null;
	requestedOwner: string;
}): LibraryDatabaseAction {
	if (input.existingOwner === null) return "create";
	if (input.existingOwner === input.requestedOwner) return "normalize";
	throw new Error(
		`The database is owned by ${input.existingOwner}, not ${input.requestedOwner}.`,
	);
}

function parseInternalPostgresHost(value: string) {
	if (!value || value.includes("/") || value.includes("@")) {
		throw new Error(
			"Internal PostgreSQL host must be a hostname with an optional port.",
		);
	}

	let url: URL;
	try {
		url = new URL(`postgresql://${value}`);
	} catch {
		throw new Error(
			"Internal PostgreSQL host must be a hostname with an optional port.",
		);
	}

	const port = url.port ? Number(url.port) : null;
	if (
		!url.hostname ||
		url.username ||
		url.password ||
		url.pathname !== "" ||
		(port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535))
	) {
		throw new Error(
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
	if (!input.password.trim()) throw new Error("Login password is required.");
	const host = parseInternalPostgresHost(input.host);

	const url = new URL("postgresql://placeholder");
	url.hostname = host.hostname;
	url.port = host.port;
	url.username = user;
	url.password = input.password;
	url.pathname = `/${database}`;
	return url.toString();
}
