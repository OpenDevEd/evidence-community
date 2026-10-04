import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { ITEMS_PER_PAGE, MAX_ITEMS_PER_PAGE } from "@/constants/items";
import { resolveSearchTopicNodes } from "./search";
import {
	resolveSearchQuery,
	type QueryIssue,
	type SearchQueryConfig,
} from "./search-query";
import { SEARCH_RESULT_LIMIT } from "./search-filter-constants";
import { loadSearchParams, RESULT_PARAMS } from "./searchParams";

const WHOLE_NUMBER = /^[1-9]\d*$/u;
/** What an endpoint takes besides the search itself. */
type EndpointOptions = {
	/** A page of the results, in an order. */
	paged?: boolean;
	perPage?: boolean;
	includeHeavyFields?: boolean;
};

/** Every option this endpoint has. A page address carries more, which stay on the page. */
function endpointNames(options: EndpointOptions) {
	return new Set<string>([
		...RESULT_PARAMS,
		...(options.paged ? ["page", "sort"] : []),
		...(options.perPage ? ["perPage"] : []),
		...(options.includeHeavyFields ? ["includeHeavyFields"] : []),
	]);
}

/** Names the endpoint does not have, and names given more than once. */
function nameIssues(searchParams: URLSearchParams, names: Set<string>) {
	return [...new Set(searchParams.keys())].flatMap((name): QueryIssue[] => {
		if (!names.has(name)) {
			return [{ parameter: name, message: `Unknown parameter: ${name}.` }];
		}
		return searchParams.getAll(name).length > 1
			? [
					{
						parameter: name,
						message: `Give ${name} once, with its values separated by commas.`,
					},
				]
			: [];
	});
}

/** A whole number from 1 to `max`. */
function numberIssue(
	parameter: string,
	value: string | null,
	max: number,
): QueryIssue[] {
	if (value === null) return [];
	if (WHOLE_NUMBER.test(value) && Number(value) <= max) return [];
	return [
		{
			parameter,
			message: `${parameter} must be a whole number from 1 to ${max}.`,
		},
	];
}

/**
 * What a public list endpoint was asked for, and everything about the request
 * it cannot honour. An endpoint that returned results anyway would hand back
 * a search the caller did not ask for, with nothing to show it.
 */
export function readPublicQuery(
	searchParams: URLSearchParams,
	config: SearchQueryConfig,
	options: EndpointOptions = {},
) {
	const names = endpointNames(options);
	const given = (name: string) => (names.has(name) ? searchParams.get(name) : null);
	const perPageIssues = numberIssue("perPage", given("perPage"), MAX_ITEMS_PER_PAGE);
	const perPage =
		given("perPage") === null || perPageIssues.length > 0
			? undefined
			: Number(given("perPage"));
	const heavy = given("includeHeavyFields");
	const search = resolveSearchQuery(loadSearchParams(searchParams), config);
	return {
		params: search.params,
		perPage,
		includeHeavyFields: heavy === "true",
		issues: [
			...nameIssues(searchParams, names),
			// The last page that can hold a result depends on how many a page holds.
			...numberIssue(
				"page",
				given("page"),
				Math.ceil(SEARCH_RESULT_LIMIT / (perPage ?? ITEMS_PER_PAGE)),
			),
			...perPageIssues,
			...(heavy === null || heavy === "true" || heavy === "false"
				? []
				: [
						{
							parameter: "includeHeavyFields",
							message: "includeHeavyFields must be true or false.",
						},
					]),
			// An option the endpoint does not have is already named above.
			...search.issues.filter(({ parameter }) => names.has(parameter)),
		],
	};
}

/**
 * The request's query for this library, or the refusal to send back: every
 * problem at once, so one round of fixes is enough.
 */
export async function readPublicRequest(
	request: Request,
	options?: EndpointOptions,
) {
	const config = await getLibraryConfig();
	const query = readPublicQuery(new URL(request.url).searchParams, config, options);
	// A topic the library does not have would filter nothing and return every result.
	const topics = new Set(
		(await resolveSearchTopicNodes(query.params, config)).map(({ id }) => id),
	);
	const unknown = query.params.topics.filter((id) => !topics.has(id));
	const issues = [
		...query.issues,
		...(unknown.length > 0
			? [
					{
						parameter: "topics",
						message: `topics takes the IDs the library lists. Unknown: ${unknown.join(", ")}.`,
					},
				]
			: []),
	];
	if (issues.length === 0) return query;
	return NextResponse.json(
		{ error: issues[0]?.message, issues },
		{ status: 400, headers: { "Cache-Control": "no-store" } },
	);
}
