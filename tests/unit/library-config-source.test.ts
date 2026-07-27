import {
	mkdtemp,
	open,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	LibraryConfigSource,
	LibraryConfigSourceError,
	resolveLibraryConfigPath,
	validateLibraryConfigFile,
} from "@/config/library-config/source";
import { MAX_LIBRARY_CONFIG_BYTES } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

let tempDirectory: string;
let configPath: string;

async function writeConfig(config: unknown) {
	await writeFile(configPath, JSON.stringify(config, null, "\t"), "utf8");
}

function expectSourceError(
	error: unknown,
	code: LibraryConfigSourceError["code"],
) {
	expect(error).toBeInstanceOf(LibraryConfigSourceError);
	expect((error as LibraryConfigSourceError).code).toBe(code);
}

beforeEach(async () => {
	tempDirectory = await mkdtemp(
		path.join(os.tmpdir(), "evidence-library-config-"),
	);
	configPath = path.join(tempDirectory, "library.json");
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(tempDirectory, { force: true, recursive: true });
});

describe("library configuration path", () => {
	it("defaults to the ignored local file outside production", () => {
		vi.stubEnv(
			"LIBRARY_CONFIG_PATH",
			"runtime/should-not-be-used.json",
		);

		expect(
			resolveLibraryConfigPath({
				cwd: "/workspace",
				environment: "development",
				path: "",
			}),
		).toBe("/workspace/config/library.local.json");
	});

	it("requires an explicit production path", () => {
		expect(() =>
			resolveLibraryConfigPath({
				environment: "production",
				path: "",
			}),
		).toThrowError(
			expect.objectContaining({ code: "CONFIG_PATH_REQUIRED" }),
		);
	});

	it("resolves a relative configured path from the working directory", () => {
		expect(
			resolveLibraryConfigPath({
				cwd: "/workspace",
				environment: "production",
				path: "runtime/library.json",
			}),
		).toBe("/workspace/runtime/library.json");
	});

	it("uses LIBRARY_CONFIG_PATH when no explicit path override is provided", () => {
		vi.stubEnv(
			"LIBRARY_CONFIG_PATH",
			"runtime/from-environment.json",
		);

		expect(
			resolveLibraryConfigPath({
				cwd: "/workspace",
				environment: "production",
			}),
		).toBe("/workspace/runtime/from-environment.json");
	});
});

describe("library configuration source", () => {
	it("loads and caches an unchanged valid revision", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		const first = await source.load();
		const second = await source.load();

		expect(first).toBe(second);
		expect(source.getHealth()).toEqual({
			state: "active",
			active: {
				schemaVersion: 1,
				revision: "minimal-1",
				updatedAt: "2026-07-27T12:00:00Z",
			},
			rejected: null,
		});
	});

	it("activates a changed revision on the next load", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});
		await source.load();

		const next = cloneLibraryConfig(minimalLibraryConfig);
		next.revision = "minimal-2";
		next.updatedAt = "2026-07-27T13:00:00Z";
		await writeConfig(next);

		expect((await source.load()).revision).toBe("minimal-2");
		expect(source.getHealth().active?.revision).toBe("minimal-2");
	});

	it("rejects changed content that reuses the active revision", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});
		await source.load();

		const changed = cloneLibraryConfig(minimalLibraryConfig);
		changed.identity.name = "Changed without a revision";
		await writeConfig(changed);

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "REVISION_REUSED");
			return true;
		});
		expect(source.getHealth()).toMatchObject({
			state: "rejected",
			active: { revision: "minimal-1" },
			rejected: { revision: "minimal-1" },
		});
	});

	it("returns detailed validation errors in development", async () => {
		const invalid = cloneLibraryConfig(minimalLibraryConfig);
		invalid.revision = "invalid-2";
		invalid.identity.name = "";
		await writeConfig(invalid);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "INVALID_CONFIG");
			expect(
				(error as LibraryConfigSourceError).details.some((detail) =>
					detail.startsWith("identity.name:"),
				),
			).toBe(true);
			return true;
		});
		expect(source.getHealth()).toMatchObject({
			state: "rejected",
			active: null,
			rejected: { revision: "invalid-2" },
		});
	});

	it("keeps the last valid revision active after a production rejection", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "production",
			path: configPath,
		});
		const active = await source.load();

		const invalid = cloneLibraryConfig(minimalLibraryConfig);
		invalid.revision = "invalid-2";
		invalid.identity.name = "";
		await writeConfig(invalid);

		expect(await source.load()).toBe(active);
		expect(await source.load()).toBe(active);
		expect(source.getHealth()).toMatchObject({
			state: "rejected",
			active: { revision: "minimal-1" },
			rejected: { revision: "invalid-2" },
		});
	});

	it("rejects invalid JSON without exposing file contents in health", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});
		await source.load();
		await writeFile(configPath, '{"revision":"secret-value"', "utf8");

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "INVALID_JSON");
			return true;
		});

		const serializedHealth = JSON.stringify(source.getHealth());
		expect(serializedHealth).not.toContain("secret-value");
		expect(serializedHealth).not.toContain("local-search-key");
	});

	it("rejects non-UTF-8 input", async () => {
		await writeFile(configPath, Buffer.from([0xc3, 0x28]));
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "INVALID_UTF8");
			return true;
		});
	});

	it("rejects raw files over 1 MiB before parsing", async () => {
		await writeFile(
			configPath,
			Buffer.alloc(MAX_LIBRARY_CONFIG_BYTES + 1, 0x20),
		);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "FILE_TOO_LARGE");
			return true;
		});
	});

	it("reports a missing source file", async () => {
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "FILE_NOT_FOUND");
			return true;
		});
	});

	it("rejects a path that is not a regular file", async () => {
		const source = new LibraryConfigSource({
			environment: "development",
			path: tempDirectory,
		});

		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "FILE_NOT_REGULAR");
			return true;
		});
	});

	it("recovers from a transient open failure without touching the file", async () => {
		await writeConfig(minimalLibraryConfig);
		let failNextOpen = false;
		const source = new LibraryConfigSource({
			environment: "development",
			openFile: async (sourcePath, flags) => {
				if (failNextOpen) {
					failNextOpen = false;
					throw Object.assign(new Error("File descriptor pressure"), {
						code: "EMFILE",
					});
				}
				return open(sourcePath, flags);
			},
			path: configPath,
		});
		const active = await source.load();

		failNextOpen = true;
		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "FILE_READ_FAILED");
			return true;
		});

		expect(await source.load()).toBe(active);
		expect(source.getHealth()).toMatchObject({
			state: "active",
			active: { revision: "minimal-1" },
			rejected: null,
		});
	});

	it("recovers from a transient read failure without another file change", async () => {
		await writeConfig(minimalLibraryConfig);
		let failNextRead = false;
		const source = new LibraryConfigSource({
			environment: "development",
			openFile: async (sourcePath, flags) => {
				const file = await open(sourcePath, flags);
				if (!failNextRead) return file;

				failNextRead = false;
				return {
					close: file.close.bind(file),
					readFile: async () => {
						throw Object.assign(new Error("Transient read failure"), {
							code: "EIO",
						});
					},
					stat: file.stat.bind(file),
				} as unknown as typeof file;
			},
			path: configPath,
		});
		const active = await source.load();

		failNextRead = true;
		await writeConfig(minimalLibraryConfig);
		const modifiedAt = new Date(Date.now() + 1_000);
		await utimes(configPath, modifiedAt, modifiedAt);
		await expect(source.load()).rejects.toSatisfy((error: unknown) => {
			expectSourceError(error, "FILE_READ_FAILED");
			return true;
		});

		expect(await source.load()).toBe(active);
		expect(source.getHealth().state).toBe("active");
	});

	it("coalesces concurrent loads into one cached revision", async () => {
		await writeConfig(minimalLibraryConfig);
		const source = new LibraryConfigSource({
			environment: "development",
			path: configPath,
		});

		const [first, second] = await Promise.all([
			source.load(),
			source.load(),
		]);

		expect(first).toBe(second);
	});

	it("validates a standalone file for the CLI", async () => {
		await writeConfig(minimalLibraryConfig);

		const config = await validateLibraryConfigFile(configPath);

		expect(config.revision).toBe("minimal-1");
	});
});
