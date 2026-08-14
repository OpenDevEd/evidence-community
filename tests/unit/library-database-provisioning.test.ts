import { describe, expect, it } from "vitest";

import {
	buildLibraryDatabaseUrl,
	decideLibraryDatabaseAction,
	parseLibraryDatabaseName,
	quotePostgresIdentifier,
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
});
