/**
 * What kind of work a record is. The levels are the evidence's own: primary studies, the syntheses that pool or sum
 * them up, and the reviews of those syntheses. `criterion` is what Jev is told a type means; `description` is what
 * readers are told.
 */
const STUDY_LEVELS = ["synthesis", "primary", "other"] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number];

export const STUDY_TYPES = [
	{
		key: "review-of-reviews", level: "synthesis", label: "Review of reviews", plural: "Reviews of reviews",
		description: "Gathers and sums up earlier reviews or meta-analyses, such as an umbrella review.",
		criterion: "Review of reviews: it gathers and sums up earlier reviews or meta-analyses, such as an umbrella review or an overview of reviews.",
	},
	{
		key: "meta-analysis", level: "synthesis", label: "Meta-analysis", plural: "Meta-analyses",
		description: "The authors statistically pool results from several earlier studies themselves. Quoting someone else's pooled result does not count.",
		criterion: "Meta-analysis: the authors statistically pool results from several earlier studies themselves, alone or within a systematic review. Citing a pooled result from someone else's meta-analysis does not count.",
	},
	{
		key: "systematic-review", level: "synthesis", label: "Systematic review", plural: "Systematic reviews",
		description: "Sums up earlier studies found with a stated search and inclusion rules, without pooling them. Includes scoping and rapid reviews.",
		criterion: "Systematic or scoping review: it sums up earlier studies found with a stated search and inclusion rules, without pooling their results. Includes rapid reviews and systematic maps.",
	},
	{
		key: "literature-review", level: "synthesis", label: "Literature review", plural: "Other literature reviews",
		description: "A narrative, critical or integrative review with no stated search method.",
		criterion: "Other literature review: a narrative, critical, integrative or state-of-the-art review with no stated search method.",
	},
	{
		key: "bibliometric", level: "synthesis", label: "Bibliometric study", plural: "Bibliometric studies",
		description: "Counts and maps publications, authors or citations on a topic, rather than what the studies found.",
		criterion: "Bibliometric or mapping study: it counts and maps publications, authors, citations or keywords on a topic, rather than summing up what the studies found.",
	},
	{
		key: "rct", level: "primary", label: "Randomised trial", plural: "Randomised trials",
		description: "Participants, groups or places were randomly assigned to conditions.",
		criterion: "Randomised controlled trial: participants, groups or places were randomly assigned to conditions.",
	},
	{
		key: "quasi-experiment", level: "primary", label: "Quasi-experiment", plural: "Quasi-experiments",
		description: "An intervention compared with a comparison group chosen without random assignment.",
		criterion: "Quasi-experimental study: an intervention compared with a comparison group without random assignment, including matched groups and difference-in-differences.",
	},
	{
		key: "quantitative", level: "primary", label: "Quantitative study", plural: "Other quantitative",
		description: "Surveys, correlational and observational studies, single-group before-and-after tests, analyses of existing data.",
		criterion: "Other quantitative study: numbers collected or analysed without comparing assigned conditions, such as a survey, a correlational or observational study, a single-group before-and-after test, or statistical analysis of existing data.",
	},
	{
		key: "qualitative", level: "primary", label: "Qualitative study", plural: "Qualitative and mixed",
		description: "Interviews, focus groups, case studies, ethnography or document analysis, alone or with quantitative data.",
		criterion: "Qualitative or mixed-methods study: interviews, focus groups, case studies, ethnography or document analysis, alone or combined with quantitative data.",
	},
	{
		key: "modelling", level: "primary", label: "Modelling study", plural: "Modelling studies",
		description: "Builds, simulates, projects or tests a model, method, tool or system, judged on how well it performs.",
		criterion: "Modelling or system development: it builds, simulates, projects or tests a model, method, tool or system, such as a climate projection, a crop model, a machine-learning model or software, judged on how well it performs.",
	},
	{
		key: "protocol", level: "other", label: "Protocol", plural: "Protocols",
		description: "A study or review that is planned or under way, with no results yet.",
		criterion: "Protocol or registration: it describes a study or review that is planned or under way, with no results yet.",
	},
	{
		key: "commentary", level: "other", label: "Commentary", plural: "Commentaries",
		description: "An editorial, opinion, policy analysis, theory or framework with no new data.",
		criterion: "Commentary or conceptual paper: an editorial, opinion, perspective, policy analysis, theory or framework with no new data.",
	},
	{
		key: "not-research", level: "other", label: "Not a research paper", plural: "Not research papers",
		description: "A dataset, software, correction, book review, or a file that accompanies another paper.",
		criterion: "Not a research paper: a dataset, software, correction, book review, peer-review report, conference programme, news item, or a file that accompanies another paper.",
	},
] as const satisfies readonly { key: string; level: StudyLevel; label: string; plural: string; description: string; criterion: string }[];
export type StudyTypeKey = (typeof STUDY_TYPES)[number]["key"];
export const STUDY_TYPE_KEYS = STUDY_TYPES.map((type) => type.key) as [StudyTypeKey, ...StudyTypeKey[]];
