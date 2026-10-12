import "server-only";

// shortcut: the mock reads OpenAlex's topic tree straight from OpenAlex and
// keeps it in memory; the real build reads OpenScholar's topic catalogue.
const OPENALEX = "https://api.openalex.org";
const USER_AGENT = "OpenScholar Evidence Library (mohammed@opendeved.net)";

export type Subfield = { field: string; id: string; name: string };
export type TopicCandidate = {
	description: string;
	id: string;
	keywords: string[];
	name: string;
	path: string[];
};

type OpenAlexNode = { display_name: string; id: string };
type OpenAlexTopic = OpenAlexNode & {
	description?: string;
	domain: OpenAlexNode;
	field: OpenAlexNode;
	keywords?: string[];
	subfield: OpenAlexNode;
};

const shortId = (url: string) => url.replace("https://openalex.org/", "");

async function openAlex<T>(path: string): Promise<{ meta: { count: number }; results: T[] }> {
	const response = await fetch(`${OPENALEX}${path}`, { headers: { "user-agent": USER_AGENT } });
	if (!response.ok) throw new Error(`OpenAlex answered ${response.status} for ${path}`);
	return response.json();
}

let subfieldList: Promise<Subfield[]> | null = null;

/** Every OpenAlex subfield, with its field, for the model to choose from. */
export function subfields() {
	subfieldList ??= Promise.all(
		[1, 2].map((page) =>
			openAlex<OpenAlexNode & { field: OpenAlexNode }>(`/subfields?per_page=200&page=${page}&select=id,display_name,field`),
		),
	)
		.then((pages) =>
			pages.flatMap(({ results }) => results).map((node) => ({ field: node.field.display_name, id: shortId(node.id), name: node.display_name })),
		)
		.catch((error: unknown) => {
			subfieldList = null;
			throw error;
		});
	return subfieldList;
}

const topicsBySubfield = new Map<string, Promise<TopicCandidate[]>>();

/** The topics under one subfield, with OpenAlex's description and keywords. */
export function subfieldTopics(subfieldId: string) {
	const cached = topicsBySubfield.get(subfieldId);
	if (cached) return cached;
	const number = subfieldId.replace("subfields/", "");
	const loading = openAlex<OpenAlexTopic>(
		`/topics?filter=subfield.id:${number}&per_page=200&select=id,display_name,description,keywords,subfield,field,domain`,
	)
		.then(({ results }) =>
			results.map((topic) => ({
				description: topic.description ?? "",
				id: shortId(topic.id),
				keywords: topic.keywords ?? [],
				name: topic.display_name,
				path: [topic.domain.display_name, topic.field.display_name, topic.subfield.display_name],
			})),
		)
		.catch((error: unknown) => {
			topicsBySubfield.delete(subfieldId);
			throw error;
		});
	topicsBySubfield.set(subfieldId, loading);
	return loading;
}
