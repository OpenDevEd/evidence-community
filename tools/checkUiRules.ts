import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadingKeys, messageProblems, sourceProblems, stylesheetProblems } from "./uiRules";

/**
 * Checks every .ts, .tsx and .css file under src/ and the copy in
 * src/messages against the UI rules in tools/uiRules.ts. The English messages
 * say which translation keys are Loading labels.
 */

function files(dir: string, extensions: string[]): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) return files(file, extensions);
		return extensions.some((extension) => file.endsWith(extension)) ? [file] : [];
	});
}

const read = (check: (file: string, text: string) => string[]) => (file: string) => check(file, readFileSync(file, "utf8"));

const loading = new Set(loadingKeys(readFileSync("src/messages/en-US.json", "utf8")));
const problems = [
	...files("src", [".ts", ".tsx"]).flatMap(read((file, text) => sourceProblems(file, text, loading))),
	...files("src", [".css"]).flatMap(read(stylesheetProblems)),
	...files("src/messages", [".json"]).flatMap(read(messageProblems)),
];

if (problems.length > 0) {
	console.error(problems.join("\n"));
	process.exit(1);
}
console.log("UI rules hold: no animation clashes, uppercase labels, native title tooltips, dot separators, Loading text or icons centred beside two lines.");
