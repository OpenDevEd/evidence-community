import { describe, expect, it } from "vitest";

import {
	buildLibraryDatabaseUrl,
	decideLibraryDatabaseAction,
	parseLibraryDatabaseName,
	quotePostgresIdentifier,
	validateLibraryDatabaseTarget,
} from "@/lib/deployment/library-database";

describe("library database provisioning contract", () => {
	it("accepts safe PostgreSQL names up to 63 bytes", () => {
		expect(parseLibraryDatabaseName("library_2026", "Database name")).toBe(
			"library_2026",
		);
		expect(
			parseLibraryDatabaseName("a".repeat(63), "Database name"),
		).toHaveLength(63);
	});

	it.each([
		"",
		"Library",
		"library-name",
		"library name",
		"library/name",
		"évidence",
		"a".repeat(64),
	])("rejects an unsafe PostgreSQL name: %s", (value) => {
		expect(() => parseLibraryDatabaseName(value, "Database name")).toThrow(
			/Database name/,
		);
	});

	it("quotes every accepted identifier", () => {
		expect(quotePostgresIdentifier("library_2026")).toBe('"library_2026"');
	});

	it("builds the runtime URL without losing password characters", () => {
		expect(
			buildLibraryDatabaseUrl({
				database: "library_2026",
				host: "postgres.internal:5432",
				password: "pa:ss/@ word",
				user: "library_2026_user",
			}),
		).toBe(
			"postgresql://library_2026_user:pa%3Ass%2F%40%20word@postgres.internal:5432/library_2026",
		);
	});

	it.each([
		"https://postgres.internal:5432",
		"postgres.internal/database",
		"user@postgres.internal",
		"postgres.internal:0",
	])("rejects an invalid internal host: %s", (host) => {
		expect(() =>
			buildLibraryDatabaseUrl({
				database: "library_2026",
				host,
				password: "password",
				user: "library_2026_user",
			}),
		).toThrow(/Internal PostgreSQL host/);
	});

	it("creates a missing database and normalizes the requested owner", () => {
		expect(
			decideLibraryDatabaseAction({
				existingOwner: null,
				requestedOwner: "library_user",
			}),
		).toBe("create");
		expect(
			decideLibraryDatabaseAction({
				existingOwner: "library_user",
				requestedOwner: "library_user",
			}),
		).toBe("normalize");
	});

	it("rejects a database owned by another login", () => {
		expect(() =>
			decideLibraryDatabaseAction({
				existingOwner: "other_user",
				requestedOwner: "library_user",
			}),
		).toThrow(/owned by other_user/);
	});

	it.each(["postgres", "template0", "template_library"])(
		"rejects a reserved database name: %s",
		(database) => {
			expect(() =>
				validateLibraryDatabaseTarget({
					adminUser: "server_admin",
					database,
					existingRole: null,
					user: "library_user",
				}),
			).toThrow(/reserved/i);
		},
	);

	it.each(["postgres", "pg_read_all_data", "server_admin"])(
		"rejects a protected login: %s",
		(user) => {
			expect(() =>
				validateLibraryDatabaseTarget({
					adminUser: "server_admin",
					database: "library_database",
					existingRole: null,
					user,
				}),
			).toThrow(/login/i);
		},
	);

	it.each([
		"isSuperuser",
		"canCreateDatabase",
		"canCreateRole",
		"canReplicate",
		"canBypassRls",
	] as const)("refuses to demote a role where %s is true", (right) => {
		expect(() =>
			validateLibraryDatabaseTarget({
				adminUser: "server_admin",
				database: "library_database",
				existingRole: {
					canBypassRls: false,
					canCreateDatabase: false,
					canCreateRole: false,
					canReplicate: false,
					isSuperuser: false,
					[right]: true,
				},
				user: "library_user",
			}),
		).toThrow(/powerful server rights/i);
	});

	it("allows a restricted existing library login", () => {
		expect(
			validateLibraryDatabaseTarget({
				adminUser: "server_admin",
				database: "library_database",
				existingRole: {
					canBypassRls: false,
					canCreateDatabase: false,
					canCreateRole: false,
					canReplicate: false,
					isSuperuser: false,
				},
				user: "library_user",
			}),
		).toBeUndefined();
	});
});
