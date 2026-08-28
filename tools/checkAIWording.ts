import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
	missingWording,
	scanWording,
	type Messages,
	type WordingUse,
} from "./aiWording";

/**
 * Checks that every piece of wording the AI screens ask for exists in every
 * language. The screens are parsed as TypeScript, so a screen cannot drop out
 * of the check by being renamed, moved, or written a different way.
 */

/** Everything the reader sees when they use the assistant. */
const AI_SOURCES = [
	"src/components/features/ai",
	"src/components/features/modals/ChatModal.tsx",
];
const MESSAGES_DIRECTORY = "src/messages";

/** Every TypeScript file under a folder, or the file itself. */
function sourceFilesIn(path: string): string[] {
	const entries = (() => {
		try {
			return readdirSync(path, { withFileTypes: true });
		} catch {
			return null;
		}
	})();

	if (!entries) return [path];

	return entries.flatMap((entry) => {
		const child = join(path, entry.name);
		if (entry.isDirectory()) return sourceFilesIn(child);

		return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
			? [child]
			: [];
	});
}

function readSources() {
	return AI_SOURCES.flatMap(sourceFilesIn)
		.sort()
		.map((file) => ({
			file: relative(process.cwd(), file),
			source: readFileSync(file, "utf8"),
		}));
}

function localeFiles() {
	return readdirSync(MESSAGES_DIRECTORY)
		.filter((name) => name.endsWith(".json"))
		.sort();
}

/** Where each missing piece of wording is asked for, so it is easy to find. */
function placesAsking(uses: WordingUse[], entry: string) {
	const files = new Set(
		uses
			.filter(({ group, key }) => `${group}.${key}` === entry)
			.map(({ file }) => file),
	);

	return [...files].sort().join(", ");
}

const sources = readSources();
const { uses, dynamic } = scanWording(sources);
const problems: string[] = [];

if (sources.length === 0) {
	problems.push(
		`No AI screens were found in ${AI_SOURCES.join(", ")}. The check is looking in the wrong place.`,
	);
}

if (uses.length === 0) {
	problems.push(
		"No wording was found in the AI screens. The check is not reading them properly.",
	);
}

for (const locale of localeFiles()) {
	const messages = JSON.parse(
		readFileSync(join(MESSAGES_DIRECTORY, locale), "utf8"),
	) as Messages;

	for (const entry of missingWording(uses, messages)) {
		problems.push(
			`${locale} has no wording for "${entry}", asked for in ${placesAsking(uses, entry)}.`,
		);
	}
}

for (const { file, group, line } of dynamic) {
	problems.push(
		`${file} line ${line} builds a "${group}" wording name while it runs, so it cannot be checked. Write the name out in full.`,
	);
}

if (problems.length > 0) {
	console.error("The AI screens ask for wording that is not there:\n");
	for (const problem of problems) console.error(`- ${problem}`);
	console.error(
		`\nAdd the missing wording to the files in ${MESSAGES_DIRECTORY}.`,
	);
	process.exit(1);
}

console.log(
	`AI wording check passed: ${uses.length} uses across ${sources.length} files, in all ${localeFiles().length} languages.`,
);
