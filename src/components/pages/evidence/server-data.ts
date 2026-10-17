import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getLibraryConfig } from "@/config/library-config/server";
import { EVIDENCE_DATA, libraryHost } from "./data";

/** The built data ships in public/, so the server reads the small parts of it straight from disk. */
export async function readEvidenceData<T>(file: string): Promise<T> {
	return JSON.parse(await readFile(path.join(process.cwd(), "public", EVIDENCE_DATA, file), "utf8")) as T;
}

/** The map's data is one library's: every other library answers as if the map did not exist. */
export async function hasEvidenceMap() {
	const [config, meta] = await Promise.all([getLibraryConfig(), readEvidenceData<{ library: string }>("meta.json")]);
	return libraryHost(config.identity.baseUrl) === meta.library;
}
