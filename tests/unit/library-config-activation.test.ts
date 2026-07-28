import {
	access,
	chmod,
	mkdtemp,
	open,
	readFile,
	readdir,
	rm,
	stat,
	unlink,
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
	activateLibraryConfig,
	rollbackLibraryConfig,
} from "@/config/library-config/activation";
import {
	LibraryConfigSourceError,
	validateLibraryConfigFile,
} from "@/config/library-config/source";
import {
	cloneLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

let tempDirectory: string;
let candidatePath: string;
let targetPath: string;

beforeEach(async () => {
	tempDirectory = await mkdtemp(
		path.join(os.tmpdir(), "evidence-library-activation-"),
	);
	candidatePath = path.join(tempDirectory, "candidate.json");
	targetPath = path.join(tempDirectory, "library.json");
});

afterEach(async () => {
	await rm(tempDirectory, { force: true, recursive: true });
});

describe("library configuration activation", () => {
	it("activates a validated candidate and preserves the previous revision for rollback", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:00:00Z";
		candidate.identity.name = "Activated Evidence Library";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);
		await writeFile(
			path.join(tempDirectory, ".library.json.999.orphan.tmp"),
			"orphan",
			"utf8",
		);

		const result = await activateLibraryConfig({
			candidatePath,
			targetPath,
		});

		expect(result.active.revision).toBe("minimal-2");
		expect(result.previous?.revision).toBe("minimal-1");
		expect((await validateLibraryConfigFile(targetPath)).revision).toBe(
			"minimal-2",
		);
		expect(
			(
				await validateLibraryConfigFile(`${targetPath}.previous`)
			).revision,
		).toBe("minimal-1");
		expect(await readFile(targetPath, "utf8")).toContain(
			'"name": "Activated Evidence Library"',
		);
		expect(
			(await readdir(tempDirectory)).filter((entry) =>
				entry.endsWith(".tmp"),
			),
		).toEqual([]);
	});

	it("refuses a concurrent operation holding the target lock", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		await writeFile(
			candidatePath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		await writeFile(
			`${targetPath}.activation.lock`,
			JSON.stringify({ pid: 1 }),
			"utf8",
		);

		await expect(
			activateLibraryConfig({ candidatePath, targetPath }),
		).rejects.toThrow("Another library configuration operation");
	});

	it("removes an exclusively created lock when lock initialization fails", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		await writeFile(
			candidatePath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);

		const probePath = path.join(tempDirectory, "file-handle-probe");
		const probe = await open(probePath, "wx");
		const fileHandlePrototype = Object.getPrototypeOf(probe);
		await probe.close();
		await unlink(probePath);
		const initializationError = new Error("simulated lock chmod failure");
		const chmodSpy = vi
			.spyOn(fileHandlePrototype, "chmod")
			.mockRejectedValueOnce(initializationError);

		try {
			await expect(
				activateLibraryConfig({ candidatePath, targetPath }),
			).rejects.toBe(initializationError);
		} finally {
			chmodSpy.mockRestore();
		}

		await expect(
			access(`${targetPath}.activation.lock`),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects an invalid candidate without changing the target or rollback revision", async () => {
		const target = JSON.stringify(minimalLibraryConfig, null, "\t");
		const previous = cloneLibraryConfig(minimalLibraryConfig);
		previous.revision = "minimal-0";
		previous.updatedAt = "2026-07-27T11:00:00Z";
		const rollback = JSON.stringify(previous, null, "\t");
		await writeFile(targetPath, target, "utf8");
		await writeFile(`${targetPath}.previous`, rollback, "utf8");

		const invalid = cloneLibraryConfig(minimalLibraryConfig);
		invalid.revision = "invalid-2";
		invalid.identity.name = "";
		await writeFile(
			candidatePath,
			JSON.stringify(invalid, null, "\t"),
			"utf8",
		);

		await expect(
			activateLibraryConfig({ candidatePath, targetPath }),
		).rejects.toBeInstanceOf(LibraryConfigSourceError);
		expect(await readFile(targetPath, "utf8")).toBe(target);
		expect(await readFile(`${targetPath}.previous`, "utf8")).toBe(
			rollback,
		);
	});

	it("rejects changed content that reuses the active revision", async () => {
		const target = JSON.stringify(minimalLibraryConfig, null, "\t");
		await writeFile(targetPath, target, "utf8");
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.identity.name = "Changed without a revision";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);

		await expect(
			activateLibraryConfig({ candidatePath, targetPath }),
		).rejects.toMatchObject({ code: "REVISION_REUSED" });
		expect(await readFile(targetPath, "utf8")).toBe(target);
		await expect(access(`${targetPath}.previous`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("replaces an invalid active file without overwriting the last valid backup", async () => {
		const invalid = cloneLibraryConfig(minimalLibraryConfig);
		invalid.revision = "invalid-2";
		invalid.identity.name = "";
		await writeFile(
			targetPath,
			JSON.stringify(invalid, null, "\t"),
			"utf8",
		);
		const rollback = JSON.stringify(minimalLibraryConfig, null, "\t");
		await writeFile(`${targetPath}.previous`, rollback, "utf8");
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:05:00Z";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);

		const result = await activateLibraryConfig({
			candidatePath,
			targetPath,
		});

		expect(result.previous).toBeNull();
		expect((await validateLibraryConfigFile(targetPath)).revision).toBe(
			"minimal-2",
		);
		expect(await readFile(`${targetPath}.previous`, "utf8")).toBe(
			rollback,
		);
	});

	it("preserves the target mode regardless of the process umask", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		await chmod(targetPath, 0o644);
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:05:00Z";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);
		const previousUmask = process.umask(0o077);

		try {
			await activateLibraryConfig({ candidatePath, targetPath });
		} finally {
			process.umask(previousUmask);
		}

		expect((await stat(targetPath)).mode & 0o777).toBe(0o644);
	});

	it("rolls back to the preserved revision and keeps the replaced revision available", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:05:00Z";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);
		await activateLibraryConfig({ candidatePath, targetPath });

		const result = await rollbackLibraryConfig({ targetPath });

		expect(result.active.revision).toMatch(/^minimal-1-rollback-/);
		expect(Date.parse(result.active.updatedAt)).toBeGreaterThan(
			Date.parse(candidate.updatedAt),
		);
		expect(result.active.identity.name).toBe(
			minimalLibraryConfig.identity.name,
		);
		expect(result.previous?.revision).toBe("minimal-2");
		expect((await validateLibraryConfigFile(targetPath)).revision).toBe(
			result.active.revision,
		);
		expect(
			(
				await validateLibraryConfigFile(`${targetPath}.previous`)
			).revision,
		).toBe("minimal-2");
	});

	it("restores the last valid backup when the active file is rejected", async () => {
		await writeFile(
			targetPath,
			JSON.stringify(minimalLibraryConfig, null, "\t"),
			"utf8",
		);
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:10:00Z";
		await writeFile(
			candidatePath,
			JSON.stringify(candidate, null, "\t"),
			"utf8",
		);
		await activateLibraryConfig({ candidatePath, targetPath });

		const invalid = cloneLibraryConfig(candidate);
		invalid.revision = "invalid-3";
		invalid.identity.name = "";
		await writeFile(
			targetPath,
			JSON.stringify(invalid, null, "\t"),
			"utf8",
		);

		await expect(
			rollbackLibraryConfig({ targetPath }),
		).rejects.toThrow("minimumUpdatedAt");

		const result = await rollbackLibraryConfig({
			minimumUpdatedAt: candidate.updatedAt,
			targetPath,
		});

		expect(result.active.revision).toMatch(/^minimal-1-rollback-/);
		expect(Date.parse(result.active.updatedAt)).toBeGreaterThan(
			Date.parse(candidate.updatedAt),
		);
		expect(result.active.identity.name).toBe(
			minimalLibraryConfig.identity.name,
		);
		expect(result.previous).toBeNull();
		expect((await validateLibraryConfigFile(targetPath)).revision).toBe(
			result.active.revision,
		);
		expect(
			(
				await validateLibraryConfigFile(`${targetPath}.previous`)
			).revision,
		).toBe("minimal-1");
	});
});
