/**
 * What kind of work a record is. The levels are the evidence's own: primary studies, the syntheses that pool or sum
 * them up, and the reviews of those syntheses. `criterion` is what Jev is told a type means. `label` is the English
 * name the admin shows; readers see the `studyTypes` messages in their own language.
 */
export const STUDY_LEVELS = [
	{ key: "synthesis", label: "Reviews and syntheses" },
	{ key: "primary", label: "Primary studies" },
	{ key: "other", label: "Other work" },
] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number]["key"];

export const STUDY_TYPES = [
	{
		key: "review-of-reviews", level: "synthesis", label: "Review of reviews",
		criterion: "Review of reviews: it gathers and sums up earlier reviews or meta-analyses, such as an umbrella review or an overview of reviews.",
	},
	{
		key: "meta-analysis", level: "synthesis", label: "Meta-analysis",
		criterion: "Meta-analysis: the authors statistically pool results from several earlier studies themselves, alone or within a systematic review. Citing a pooled result from someone else's meta-analysis does not count.",
	},
	{
		key: "systematic-review", level: "synthesis", label: "Systematic review",
		criterion: "Systematic or scoping review: it sums up earlier studies found with a stated search and inclusion rules, without pooling their results. Includes rapid reviews and systematic maps.",
	},
	{
		key: "literature-review", level: "synthesis", label: "Literature review",
		criterion: "Other literature review: a narrative, critical, integrative or state-of-the-art review with no stated search method.",
	},
	{
		key: "bibliometric", level: "synthesis", label: "Bibliometric study",
		criterion: "Bibliometric or mapping study: it counts and maps publications, authors, citations or keywords on a topic, rather than summing up what the studies found.",
	},
	{
		key: "rct", level: "primary", label: "Randomised trial",
		criterion: "Randomised controlled trial: participants, groups or places were randomly assigned to conditions.",
	},
	{
		key: "quasi-experiment", level: "primary", label: "Quasi-experiment",
		criterion: "Quasi-experimental study: an intervention compared with a comparison group without random assignment, including matched groups and difference-in-differences.",
	},
	{
		key: "quantitative", level: "primary", label: "Quantitative study",
		criterion: "Other quantitative study: numbers collected or analysed without comparing assigned conditions, such as a survey, a correlational or observational study, a single-group before-and-after test, or statistical analysis of existing data.",
	},
	{
		key: "qualitative", level: "primary", label: "Qualitative study",
		criterion: "Qualitative or mixed-methods study: interviews, focus groups, case studies, ethnography or document analysis, alone or combined with quantitative data.",
	},
	{
		key: "modelling", level: "primary", label: "Modelling study",
		criterion: "Modelling or system development: it builds, simulates, projects or tests a model, method, tool or system, such as a climate projection, a crop model, a machine-learning model or software, judged on how well it performs.",
	},
	{
		key: "protocol", level: "other", label: "Protocol",
		criterion: "Protocol or registration: it describes a study or review that is planned or under way, with no results yet.",
	},
	{
		key: "commentary", level: "other", label: "Commentary",
		criterion: "Commentary or conceptual paper: an editorial, opinion, perspective, policy analysis, theory or framework with no new data.",
	},
	{
		key: "not-research", level: "other", label: "Not a research paper",
		criterion: "Not a research paper: a dataset, software, correction, book review, peer-review report, conference programme, news item, or a file that accompanies another paper.",
	},
] as const satisfies readonly { key: string; level: StudyLevel; label: string; criterion: string }[];
export type StudyTypeKey = (typeof STUDY_TYPES)[number]["key"];
export const STUDY_TYPE_KEYS = STUDY_TYPES.map((type) => type.key) as [StudyTypeKey, ...StudyTypeKey[]];
export const studyType = (key: string) => STUDY_TYPES.find((type) => type.key === key);

/**
 * One record's reading as readers see it: its type, how sure Jev was, whether the record's own metadata said it
 * instead, and what Jev read.
 */
export type StudyReading = { type: StudyTypeKey; confidence: number; by: "ai" | "metadata"; input: "abstract" | "title" | "pdf" };
/** Below this, Jev's type is shown as uncertain, and asked again from the record's PDF once it has one. */
export const SURE = 0.6;
