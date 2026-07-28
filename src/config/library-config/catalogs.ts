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
		attributesToSearchOn: [
			"title",
			"abstractNote",
			"tags",
			"fullNames",
		],
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
		attributesToSearchOn: [
			"title",
			"abstractNote",
			"fullNames",
			"tags",
		],
	},
	{
		key: "documents",
		legacyKey: "fulltext",
		name: "Full text only",
		attributesToSearchOn: ["fullTextPDFs.fullTextPDF.text"],
	},
	{
		key: "everywhere",
		legacyKey: "all",
		name: "Everywhere",
		attributesToSearchOn: ["*"],
	},
] as const;

export type PlatformSearchScope =
	(typeof PLATFORM_SEARCH_SCOPE_OPTIONS)[number]["key"];

export const PLATFORM_SEARCH_SCOPES =
	PLATFORM_SEARCH_SCOPE_OPTIONS.map(({ key }) => key) as [
		PlatformSearchScope,
		...PlatformSearchScope[],
	];

export const PLATFORM_NAVBAR_ICON_IDS = [
	"AboutUs",
	"EvidenceLibrary",
	"Programs",
	"Blog",
	"Team",
	"ContactUs",
	"TeamFill",
	"ToolsFill",
	"BookOpenFill",
	"Bookshelf",
	"ChatRightDotsFill",
	"BsMapFill",
	"LuX",
	"FaQuestionCircle",
	"IoStatsChart",
] as const;

export type PlatformNavbarIconId =
	(typeof PLATFORM_NAVBAR_ICON_IDS)[number];

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
	Ubuntu: {
		weights: [300, 400, 500, 700],
	},
} as const;

export const PLATFORM_AI_MODEL_CATALOG = {
	openai: {
		active: ["gpt-5.4", "gpt-5.4-mini"],
		large: ["gpt-5.4"],
		small: ["gpt-5.4-mini"],
	},
	google: {
		active: ["gemini-2.5-flash", "gemini-2.5-pro"],
		large: ["gemini-2.5-pro"],
		small: ["gemini-2.5-flash"],
	},
	anthropic: {
		active: ["claude-sonnet-4-6", "claude-haiku-4-5"],
		large: ["claude-sonnet-4-6"],
		small: ["claude-haiku-4-5"],
	},
	mistral: {
		active: ["mistral-large-latest", "mistral-small-latest"],
		large: ["mistral-large-latest"],
		small: ["mistral-small-latest"],
	},
	deepseek: {
		active: ["deepseek-v4-pro", "deepseek-v4-flash"],
		large: ["deepseek-v4-pro"],
		small: ["deepseek-v4-flash"],
	},
} as const;

export const PLATFORM_AI_PROVIDERS = Object.keys(
	PLATFORM_AI_MODEL_CATALOG,
) as [
	keyof typeof PLATFORM_AI_MODEL_CATALOG,
	...(keyof typeof PLATFORM_AI_MODEL_CATALOG)[],
];

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

export const PLATFORM_SEARCH_EMBEDDER = "openai";
