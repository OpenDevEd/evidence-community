import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	createLibraryConfigCatalog,
	createLibraryConfigJsonSchema,
} from "../src/config/library-config/artifacts";

const publicDirectory = path.join(process.cwd(), "public");
const artifacts = [
	{
		path: path.join(publicDirectory, "library-config.schema.json"),
		value: createLibraryConfigJsonSchema(),
	},
	{
		path: path.join(publicDirectory, "library-config.catalogs.json"),
		value: createLibraryConfigCatalog(),
	},
] as const;

function serialize(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

async function main() {
	const check = process.argv.slice(2).includes("--check");

	for (const artifact of artifacts) {
		const content = serialize(artifact.value);
		if (check) {
			const existing = await readFile(artifact.path, "utf8").catch(
				() => null,
			);
			if (existing !== content) {
				throw new Error(
					`${path.relative(process.cwd(), artifact.path)} is out of date; run npm run schema:generate:library-config`,
				);
			}
			continue;
		}

		await writeFile(artifact.path, content, "utf8");
		console.log(`Generated ${path.relative(process.cwd(), artifact.path)}`);
	}
}

void main();
