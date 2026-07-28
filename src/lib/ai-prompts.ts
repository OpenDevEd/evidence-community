import "server-only";

import {
	PLATFORM_PROMPT_DEFAULTS,
	type PLATFORM_PROMPT_SLOTS,
} from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type AIPromptSlot = (typeof PLATFORM_PROMPT_SLOTS)[number];

type ProcessingRule =
	LibraryServerConfig["processing"]["sharedRules"][number];

function ruleApplies(rule: ProcessingRule, hasPdf: boolean) {
	return rule.condition === "always" ||
		(rule.condition === "has-pdf" && hasPdf);
}

function compareRules(left: ProcessingRule, right: ProcessingRule) {
	return left.priority - right.priority ||
		left.id.localeCompare(right.id);
}

export function getAIProcessingInstructions(
	config: Pick<LibraryServerConfig, "processing">,
	hasPdf: boolean,
) {
	const rules = [
		...config.processing.sharedRules,
		...(hasPdf ? config.processing.pdfRules : []),
		...(hasPdf ? config.processing.structureRules : []),
	]
		.filter((rule) => ruleApplies(rule, hasPdf))
		.sort(compareRules);

	return rules.map((rule) => rule.value);
}

export function getAISystemPrompt(
	config: Pick<LibraryServerConfig, "ai" | "processing">,
	slot: AIPromptSlot,
	{
		hasPdf,
		locale,
	}: {
		hasPdf: boolean;
		locale: string;
	},
) {
	return [
		`LOCALE: ${locale}`,
		config.ai.prompts[slot] ?? PLATFORM_PROMPT_DEFAULTS[slot],
		...getAIProcessingInstructions(config, hasPdf),
	]
		.filter(Boolean)
		.join("\n");
}
