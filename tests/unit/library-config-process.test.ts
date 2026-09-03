import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { watchLibraryConfigChanges } from "@/config/library-config/process";
import { replaceFileAtomically } from "@/lib/atomic-file";

let tempDirectory: string;
let targetPath: string;

beforeEach(async () => {
	tempDirectory = await mkdtemp(
		path.join(os.tmpdir(), "library-config-watch-"),
	);
	targetPath = path.join(tempDirectory, "library.json");
	await writeFile(targetPath, "old", "utf8");
});

afterEach(async () => {
	await rm(tempDirectory, { force: true, recursive: true });
});

describe("library configuration process watcher", () => {
	it("notifies once when atomic activation replaces the active file", async () => {
		let resolveChanged: () => void = () => undefined;
		const changed = new Promise<void>((resolve) => {
			resolveChanged = resolve;
		});
		const watcher = watchLibraryConfigChanges({
			onChange: resolveChanged,
			targetPath,
		});

		await replaceFileAtomically({
			content: "new",
			mode: 0o640,
			targetPath,
		});
		await expect(
			Promise.race([
				changed,
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error("watcher timed out")),
						2_000,
					),
				),
			]),
		).resolves.toBeUndefined();
		watcher.close();
	});
});
