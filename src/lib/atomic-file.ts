import { randomUUID } from "node:crypto";
import {
	open,
	readdir,
	rename,
	unlink,
} from "node:fs/promises";
import path from "node:path";

async function syncDirectory(directory: string) {
	const handle = await open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function replaceFileAtomically({
	content,
	mode,
	targetPath,
}: {
	content: string | Uint8Array;
	mode: number;
	targetPath: string;
}) {
	const directory = path.dirname(targetPath);
	const temporaryPath = path.join(
		directory,
		`.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let handle;

	try {
		handle = await open(temporaryPath, "wx", mode);
		await handle.chmod(mode);
		await handle.writeFile(content);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, targetPath);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

export async function removeAtomicTemporaryFiles(targetPath: string) {
	const directory = path.dirname(targetPath);
	const prefix = `.${path.basename(targetPath)}.`;
	const entries = await readdir(directory, { withFileTypes: true });

	await Promise.all(
		entries
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.startsWith(prefix) &&
					entry.name.endsWith(".tmp"),
			)
			.map((entry) =>
				unlink(path.join(directory, entry.name)).catch(
					(error: NodeJS.ErrnoException) => {
						if (error.code !== "ENOENT") throw error;
					},
				),
			),
	);
}
