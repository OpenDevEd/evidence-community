import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";

export type ResearchToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolMessage = { key: string; values: Record<string, number> };

export type ToolActivitySummary = {
	toolName: string;
	/** A message key in `toolActivity`, or the name of a tool with none. */
	title: string;
	items: string[];
	/** The English line the transcript export writes. */
	detail?: string;
	/** The same line as a message in `toolActivity`, for the page. */
	message?: ToolMessage;
	error?: string;
	currentResults?: {
		start?: number;
		end?: number;
		total?: number;
		hasMore?: boolean;
	};
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function numberOrUndefined(value: unknown) {
	return typeof value === "number" ? value : undefined;
}

function toolOutput(part: ResearchToolPart) {
	return part.state === "output-available" && isRecord(part.output)
		? part.output
		: undefined;
}

function currentResultsWindow(output: Record<string, unknown> | undefined) {
	const window = isRecord(output?.currentResults)
		? output.currentResults
		: undefined;

	return {
		start: numberOrUndefined(window?.start),
		end: numberOrUndefined(window?.end),
		total: numberOrUndefined(window?.total),
		hasMore:
			typeof window?.hasMore === "boolean" ? window.hasMore : undefined,
	};
}

function queryResults(output: Record<string, unknown> | undefined) {
	const results = Array.isArray(output?.queries) ? output.queries : [];
	const hits = results.reduce((total, result) => {
		if (!isRecord(result)) return total;
		return total + (Array.isArray(result.hits) ? result.hits.length : 0);
	}, 0);

	return { queryCount: results.length, hits };
}

function searchTitle(isListing: boolean, withinResults: boolean, done: boolean) {
	if (isListing) return done ? "title.readCurrent" : "title.readingCurrent";
	if (withinResults) {
		return done ? "title.searchedCurrent" : "title.searchingCurrent";
	}
	return "title.search";
}

function searchDetail(
	isListing: boolean,
	window: ToolActivitySummary["currentResults"],
	output: Record<string, unknown> | undefined,
): { text: string; message: ToolMessage } {
	if (isListing) {
		const listed =
			window?.start !== undefined &&
			window.end !== undefined &&
			window.start > 0
				? window.end - window.start + 1
				: 0;
		return { text: `${listed} ${listed === 1 ? "entry" : "entries"} in displayed order`, message: { key: "entriesInOrder", values: { count: listed } } };
	}

	const { hits, queryCount } = queryResults(output);
	return { text: `${hits} ${hits === 1 ? "result" : "results"} across ${queryCount} ${queryCount === 1 ? "query" : "queries"}`, message: { key: "resultsAcross", values: { hits, queries: queryCount } } };
}

function searchSummary(
	part: ResearchToolPart,
	toolName: string,
	error: string | undefined,
): ToolActivitySummary {
	const input = isRecord(part.input) ? part.input : undefined;
	const items = stringArray(input?.queries);
	const withinResults = input?.withinCurrentResults === true;
	const isListing = withinResults && items.length === 0;
	const done = part.state === "output-available";
	const output = toolOutput(part);

	return {
		toolName,
		title: searchTitle(isListing, withinResults, done),
		items,
		currentResults: withinResults
			? currentResultsWindow(output)
			: undefined,
		...(done ? (({ text, message }) => ({ detail: text, message }))(searchDetail(isListing, currentResultsWindow(output), output)) : {}),
		error,
	};
}

/** What one step of the assistant's work should say to the reader. */
export function toolActivitySummary(
	part: ResearchToolPart,
): ToolActivitySummary {
	const toolName = getToolName(part);
	const error = part.state === "output-error" ? part.errorText : undefined;

	if (toolName === "searchLibrary") {
		return searchSummary(part, toolName, error);
	}

	if (toolName === "readPublications") {
		const input = isRecord(part.input) ? part.input : undefined;
		return {
			toolName,
			title: "title.readingPublications",
			items: stringArray(input?.itemKeys),
			error,
		};
	}

	return {
		toolName,
		title: toolName,
		items: [],
		...(error ? {} : { detail: "No additional details.", message: { key: "noDetails", values: {} } }),
		error,
	};
}
