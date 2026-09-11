import { FULL_TEXT_PDF_ATTRIBUTE } from "../../lib/search-filter-constants";

export const PLATFORM_LOCALES = [
	"en-GB",
	"en-US",
	"de",
	"ar",
	"hi",
	"fr",
	"cn",
	"sw",
	"pt",
] as const;

export const PLATFORM_SEARCH_SCOPE_OPTIONS = [
	{
		key: "title_abstract_author_and_keywords",
		legacyKey: "title_and_abstract",
		name: "Title, abstract, authors and keywords",
		attributesToSearchOn: ["title", "abstractNote", "tags", "fullNames"],
	},
	{
		key: "title_abstract_and_keywords",
		legacyKey: "title_and_abstract",
		name: "Title, abstract and keywords",
		attributesToSearchOn: ["title", "abstractNote", "tags"],
	},
	{
		key: "title_and_abstract",
		legacyKey: "title_and_abstract",
		name: "Title and abstract",
		attributesToSearchOn: ["title", "abstractNote"],
	},
	{
		key: "title",
		legacyKey: "title",
		name: "Title only",
		attributesToSearchOn: ["title"],
	},
	{
		key: "authors",
		legacyKey: "creator",
		name: "Authors and contributors",
		attributesToSearchOn: ["fullNames"],
	},
	{
		key: "fields",
		legacyKey: "metadata",
		name: "All metadata",
		attributesToSearchOn: ["metadataSearch", "tags"],
	},
	{
		key: "documents",
		legacyKey: "fulltext",
		name: "Full text only",
		attributesToSearchOn: [FULL_TEXT_PDF_ATTRIBUTE],
	},
	{
		key: "everywhere",
		legacyKey: "all",
		name: "Everywhere",
		attributesToSearchOn: [
			"metadataSearch",
			"tags",
			FULL_TEXT_PDF_ATTRIBUTE,
		],
	},
] as const;

export type PlatformSearchScope =
	(typeof PLATFORM_SEARCH_SCOPE_OPTIONS)[number]["key"];

export const PLATFORM_SEARCH_SCOPES = PLATFORM_SEARCH_SCOPE_OPTIONS.map(
	({ key }) => key,
) as [PlatformSearchScope, ...PlatformSearchScope[]];

export const PLATFORM_SOCIAL_PROVIDERS = [
	"github",
	"twitter",
	"linkedin",
	"youtube",
	"bluesky",
] as const;

export const PLATFORM_FONT_CATALOG = {
	Montserrat: {
		weights: [300, 400, 500, 700],
	},
	Poppins: {
		weights: [300, 400, 500, 700],
	},
	Ubuntu: {
		weights: [300, 400, 500, 700],
	},
} as const;

export const PLATFORM_AI_PROVIDERS = [
	"openai",
	"google",
	"anthropic",
	"mistral",
	"deepseek",
	"openrouter",
] as const;

export const PLATFORM_PROMPT_SLOTS = [
	"questions",
	"chat",
	"explain",
	"summarize",
] as const;

export const PLATFORM_PROMPT_DEFAULTS: Record<
	(typeof PLATFORM_PROMPT_SLOTS)[number],
	string
> = {
	questions: [
		"You generate exactly five useful questions about the supplied evidence.",
		"Use the requested locale.",
		"Only ask questions that can be answered from the supplied evidence.",
	].join("\n"),
	chat: [
		"You are an evidence research assistant.",
		"Answer from the supplied evidence and state clearly when the evidence does not answer the question.",
		"Use regular Markdown unless quoting PDF content.",
	].join("\n"),
	explain: [
		"You are an analytical evidence research assistant.",
		"Explain the methods, findings, implications, limitations, and technical terms in the supplied evidence.",
		"Use clear Markdown and do not introduce unsupported claims.",
	].join("\n"),
	summarize: [
		"You are a concise evidence research assistant.",
		"Summarize the research question, key findings, conclusions, and implications from the supplied evidence.",
		"Use clear Markdown and do not introduce unsupported claims.",
	].join("\n"),
};

export const PLATFORM_PROMPT_VARIABLES: Record<
	(typeof PLATFORM_PROMPT_SLOTS)[number],
	readonly string[]
> = {
	// No runtime prompt variables are approved yet. Keep each slot explicit so
	// adding one later is a deliberate schema/catalog change.
	questions: [],
	chat: [],
	explain: [],
	summarize: [],
};

export const PLATFORM_RULE_CONDITIONS = ["always", "has-pdf"] as const;

export const PLATFORM_RULE_ACTIONS = ["append-system-instruction"] as const;

export const PLATFORM_SEARCH_EMBEDDER = "default";
