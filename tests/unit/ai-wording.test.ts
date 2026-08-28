import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AI_FILES = [
	"src/components/features/ai/ChatComposerControls.tsx",
	"src/components/features/ai/ChatMessage.tsx",
	"src/components/features/ai/InlineLibraryChat.tsx",
	"src/components/features/ai/PoweredByOpenScholar.tsx",
	"src/components/features/ai/SmartScreeningModal.tsx",
	"src/components/features/ai/chat-shared.tsx",
	"src/components/features/modals/ChatModal.tsx",
];

type Messages = Record<string, Record<string, string>>;

function localeNames() {
	return readdirSync("src/messages").filter((name) => name.endsWith(".json"));
}

function messagesFor(locale: string): Messages {
	return JSON.parse(
		readFileSync(join("src/messages", locale), "utf8"),
	) as Messages;
}

/** Every piece of wording the AI screens ask for, as group and key. */
function wordingUsed() {
	const used = new Set<string>();
	for (const file of AI_FILES) {
		const source = readFileSync(file, "utf8");
		const groups = new Map<string, string>();
		for (const match of source.matchAll(
			/const (\w+) = useTranslations\("(\w+)"\)/g,
		)) {
			groups.set(match[1], match[2]);
		}
		for (const [variable, group] of groups) {
			for (const match of source.matchAll(
				new RegExp(`\\b${variable}(?:\\.rich)?\\("([\\w.]+)"`, "g"),
			)) {
				used.add(`${group}.${match[1]}`);
			}
		}
	}

	return [...used].sort();
}

describe("the wording the AI screens ask for", () => {
	const used = wordingUsed();

	it("reads wording from more than one group", () => {
		expect(used.length).toBeGreaterThan(20);
	});

	it.each(localeNames())("exists in %s", (locale) => {
		const messages = messagesFor(locale);
		const missing = used.filter((entry) => {
			const [group, key] = entry.split(".");

			return !messages[group]?.[key];
		});

		expect(missing).toEqual([]);
	});
});
