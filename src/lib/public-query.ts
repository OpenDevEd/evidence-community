import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { MAX_ITEMS_PER_PAGE } from "@/constants/items";
import {
	resolveSearchQuery,
	type QueryIssue,
	type SearchQueryConfig,
} from "./search-query";
import { SEARCH_RESULT_LIMIT } from "./search-filter-constants";
import { loadSearchParams, searchParamsLoader } from "./searchParams";

const WHOLE_NUMBER = /^[1-9]\d*$/u;
/** The options an endpoint may have besides the search itself. */
type EndpointOptions = { perPage?: boolean; includeHeavyFields?: boolean };

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
	const names = new Set([
		...Object.keys(searchParamsLoader),
		...Object.keys(options),
	]);
	const perPage = options.perPage ? searchParams.get("perPage") : null;
	const heavy = options.includeHeavyFields
		? searchParams.get("includeHeavyFields")
		: null;
	const search = resolveSearchQuery(loadSearchParams(searchParams), config);
	return {
		params: search.params,
		perPage: perPage === null ? undefined : Number(perPage),
		includeHeavyFields: heavy === "true",
		issues: [
			...nameIssues(searchParams, names),
			...numberIssue("page", searchParams.get("page"), SEARCH_RESULT_LIMIT),
			...numberIssue("perPage", perPage, MAX_ITEMS_PER_PAGE),
			...(heavy === null || heavy === "true" || heavy === "false"
				? []
				: [
						{
							parameter: "includeHeavyFields",
							message: "includeHeavyFields must be true or false.",
						},
					]),
			...search.issues,
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
	const query = readPublicQuery(
		new URL(request.url).searchParams,
		await getLibraryConfig(),
		options,
	);
	if (query.issues.length === 0) return query;
	return NextResponse.json(
		{ error: query.issues[0]?.message, issues: query.issues },
		{ status: 400, headers: { "Cache-Control": "no-store" } },
	);
}
