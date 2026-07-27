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

export const PLATFORM_SEARCH_SCOPES = [
	"title_abstract_author_and_keywords",
	"title_abstract_and_keywords",
	"title_and_abstract",
	"title",
	"authors",
	"fields",
	"documents",
	"everywhere",
] as const;

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
		active: ["gpt-5-mini"],
		large: ["gpt-5-mini"],
		small: ["gpt-5-mini"],
	},
	google: {
		active: ["gemini-2.5-flash", "gemini-2.5-pro"],
		large: ["gemini-2.5-pro"],
		small: ["gemini-2.5-flash"],
	},
	anthropic: {
		active: [
			"claude-3-5-sonnet-20241022",
			"claude-3-5-haiku-20241022",
		],
		large: ["claude-3-5-sonnet-20241022"],
		small: ["claude-3-5-haiku-20241022"],
	},
	mistral: {
		active: ["mistral-large-latest"],
		large: ["mistral-large-latest"],
		small: ["mistral-large-latest"],
	},
	deepseek: {
		active: ["deepseek-chat"],
		large: ["deepseek-chat"],
		small: ["deepseek-chat"],
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
