import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PLATFORM_PROMPT_DEFAULTS } from "@/config/library-config/catalogs";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	getAIProcessingInstructions,
	getAISystemPrompt,
} from "@/lib/ai-prompts";
import { cloneLibraryConfig } from "../fixtures/library-config";

function config() {
	return libraryConfigSchema.parse(cloneLibraryConfig());
}

describe("runtime AI prompts", () => {
	it("uses the platform default unless the library overrides a slot", () => {
		const libraryConfig = config();
		delete libraryConfig.ai.prompts.summarize;

		expect(
			getAISystemPrompt(libraryConfig, "summarize", {
				hasPdf: false,
				locale: "en-GB",
			}),
		).toContain(PLATFORM_PROMPT_DEFAULTS.summarize);

		libraryConfig.ai.prompts.summarize =
			"Use this library-specific summary instruction.";
		expect(
			getAISystemPrompt(libraryConfig, "summarize", {
				hasPdf: false,
				locale: "en-GB",
			}),
		).toContain(
			"Use this library-specific summary instruction.",
		);
	});

	it("applies PDF rules only for PDF content and sorts all rules", () => {
		const libraryConfig = config();
		libraryConfig.processing.sharedRules = [
			{
				id: "shared-last",
				priority: 30,
				condition: "always",
				action: "append-system-instruction",
				value: "Shared last",
			},
		];
		libraryConfig.processing.pdfRules = [
			{
				id: "pdf-first",
				priority: 10,
				condition: "has-pdf",
				action: "append-system-instruction",
				value: "PDF first",
			},
		];
		libraryConfig.processing.structureRules = [
			{
				id: "structure-middle",
				priority: 20,
				condition: "always",
				action: "append-system-instruction",
				value: "Structure middle",
			},
		];

		expect(getAIProcessingInstructions(libraryConfig, false)).toEqual([
			"Shared last",
		]);
		expect(getAIProcessingInstructions(libraryConfig, true)).toEqual([
			"PDF first",
			"Structure middle",
			"Shared last",
		]);
	});
});
