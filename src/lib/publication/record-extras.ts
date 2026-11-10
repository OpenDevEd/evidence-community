import { and, eq, inArray } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemLink } from "@/db/schema/tables/itemLink";
import { resolveCountryFocus } from "@/lib/country-focus";
import { readStudyReading } from "@/lib/readings/reading";
import { resolveTopicNodes } from "@/lib/topics/catalog";
import { resolveBibliographicDoi } from "./bibliographic-doi";
import type { PublicationRepositorySnapshot } from "./repository";

/**
 * What a record's deposit carries beyond its own row (OpenDevEd/openalex-count plans/registrar-metadata): the records
 * it cites and relates to, by their DOIs, its topics by name, the ROR of each institution its creators name, and the
 * published file's address and type.
 */
export type PublicationRecordExtras = {
	links: readonly { kind: "cites" | "related"; key: string; doi: string | null }[];
	topicNames: readonly string[];
	/** The study type and the countries as readers see them: an editor's choice, else what was read from the record. */
	studyType?: string;
	countries: readonly string[];
	/** Each institution's ROR, by its OpenAlex ID (`I4210087849`). */
	institutionRors: Readonly<Record<string, string>>;
	fullTextUrl?: string;
	formats: readonly string[];
};

export type PublicationExtrasConfig = Pick<LibraryServerConfig, "identity" | "services"> &
	Partial<Pick<LibraryServerConfig, "topics" | "authentication">>;

/** An OpenAlex ID as one short key, however it was kept. */
export const openAlexKey = (id: string) => id.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();

const OPENALEX_IDS_PER_REQUEST = 50;

export async function loadPublicationRecordExtras(
	database: Database,
	snapshot: PublicationRepositorySnapshot,
	config: PublicationExtrasConfig,
	request: typeof fetch = fetch,
): Promise<PublicationRecordExtras> {
	const record = snapshot.record;
	if (!record) return { links: [], topicNames: [], countries: [], institutionRors: {}, formats: [] };
	// The records this one cites, and the ones related to it whichever way the link was made: related is both ways.
	const outgoing = await database
		.select({ kind: itemLink.kind, key: itemLink.toKey, DOI: item.DOI, extra: item.extra })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.toKey))
		.where(and(eq(itemLink.fromKey, record.key), inArray(itemLink.kind, ["cites", "related"])));
	const incoming = await database
		.select({ kind: itemLink.kind, key: itemLink.fromKey, DOI: item.DOI, extra: item.extra })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.fromKey))
		.where(and(eq(itemLink.toKey, record.key), eq(itemLink.kind, "related")));
	const links = [...outgoing, ...incoming].filter((link, index, all) => all.findIndex((other) => other.kind === link.kind && other.key === link.key) === index);
	const reading = record.studyType ? null : await readStudyReading(database, record.key);
	// Topics are named by the catalog the library reads them from.
	const topicNames =
		config.topics?.enabled && config.authentication && record.topics.length
			? (await resolveTopicNodes(record.topics, { database, config: { authentication: config.authentication }, fetch: request }, { allowUnknown: true })).map((node) => node.name)
			: [];
	const pdf = snapshot.files.find((file) => file.contentType === "application/pdf");
	return {
		// A linked record's DOI wherever it keeps one: its DOI field or its Extra.
		links: links.map((link) => ({ kind: link.kind, key: link.key, doi: resolveBibliographicDoi({ DOI: link.DOI, extra: link.extra }).doi })),
		topicNames: [...new Set(topicNames)].sort(),
		...((record.studyType ?? reading?.type) ? { studyType: (record.studyType ?? reading?.type)! } : {}),
		countries: resolveCountryFocus({ title: record.title, abstractNote: record.abstractNote, countryFocus: record.countryFocus }),
		institutionRors: await institutionRors(record.creators ?? [], config.services.openAlex?.apiKey, request),
		...(pdf ? { fullTextUrl: new URL(`/api/item/${record.key}/download/${pdf.itemKey}`, config.identity.baseUrl).toString() } : {}),
		formats: [...new Set(snapshot.files.map((file) => file.contentType))].sort(),
	};
}

/** Each institution's ROR from OpenAlex, which names institutions by its own IDs: one request per 50. */
async function institutionRors(
	creators: readonly { institutions?: readonly { id?: string | null }[] }[],
	apiKey: string | undefined,
	request: typeof fetch,
) {
	const ids = [...new Set(creators.flatMap((creator) => (creator.institutions ?? []).flatMap((institution) => (institution.id ? [openAlexKey(institution.id)] : []))))];
	const rors: Record<string, string> = {};
	for (let at = 0; at < ids.length; at += OPENALEX_IDS_PER_REQUEST) {
		const url = new URL("https://api.openalex.org/institutions");
		url.searchParams.set("filter", `openalex:${ids.slice(at, at + OPENALEX_IDS_PER_REQUEST).join("|")}`);
		url.searchParams.set("select", "id,ids");
		url.searchParams.set("per-page", String(OPENALEX_IDS_PER_REQUEST));
		if (apiKey) url.searchParams.set("api_key", apiKey);
		const response = await request(url, { signal: AbortSignal.timeout(30_000) });
		// The deposit waits for what it would carry: the job tries again, as for a registrar that can't be reached.
		if (!response.ok) throw new Error(`OpenAlex answered ${response.status} when asked for the record's institutions`);
		const { results } = (await response.json()) as { results: { id: string; ids?: { ror?: string | null } }[] };
		for (const institution of results) if (institution.ids?.ror) rors[openAlexKey(institution.id)] = institution.ids.ror;
	}
	return rors;
}
