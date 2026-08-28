export type AIHistory = {
	id: string;
	title: string;
	key: string;
	content: string;
	date: Date;
	modelId: string;
};

export const SMART_SCREENING_FIELD_TYPES = [
	"string",
	"number",
	"boolean",
] as const;

/** One question a reader asks of every publication they screen. */
export type SmartScreeningField = {
	label: string;
	description: string;
	type: (typeof SMART_SCREENING_FIELD_TYPES)[number];
};

/** Quick answers, or the slower Deep Research pass. */
export type ChatMode = "research" | "quick";
