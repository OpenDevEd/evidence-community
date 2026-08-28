import {
	aiWordingFiles,
	localeMessages,
	wordingProblems,
} from "./aiWording";

/**
 * Checks that every piece of wording the AI screens ask for exists in every
 * language. The screens are parsed as TypeScript, so a screen cannot drop out
 * of the check by being renamed, moved, or written a different way.
 */

const files = aiWordingFiles();
const locales = localeMessages();
const problems = wordingProblems(files, locales);

if (problems.length > 0) {
	console.error("The AI screens ask for wording that is not there:\n");
	for (const problem of problems) console.error(`- ${problem}`);
	console.error("\nAdd the missing wording to the files in src/messages.");
	process.exit(1);
}

console.log(
	`AI wording check passed: ${files.length} screens read, in all ${locales.length} languages.`,
);
