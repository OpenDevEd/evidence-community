import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";

export type ResearchToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolActivitySummary = {
	toolName: string;
	title: string;
	items: string[];
	detail?: string;
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

export function toolActivitySummary(
	part: ResearchToolPart,
): ToolActivitySummary {
	const toolName = getToolName(part);
	const input = isRecord(part.input) ? part.input : undefined;
	const error = part.state === "output-error" ? part.errorText : undefined;

	if (toolName === "searchLibrary") {
		const items = stringArray(input?.queries);
		const isCurrentResultsSearch = input?.withinCurrentResults === true;
		const isListing = isCurrentResultsSearch && items.length === 0;
		const output =
			part.state === "output-available" && isRecord(part.output)
				? part.output
				: undefined;
		const results = Array.isArray(output?.queries) ? output.queries : [];
		const outputWindow = isRecord(output?.currentResults)
			? output.currentResults
			: undefined;
		const currentResults = isCurrentResultsSearch
			? {
					start:
						typeof outputWindow?.start === "number"
							? outputWindow.start
							: undefined,
					end:
						typeof outputWindow?.end === "number"
							? outputWindow.end
							: undefined,
					total:
						typeof outputWindow?.total === "number"
							? outputWindow.total
							: undefined,
					hasMore:
						typeof outputWindow?.hasMore === "boolean"
							? outputWindow.hasMore
							: undefined,
				}
			: undefined;
		const resultCount = results.reduce((total, result) => {
			if (!isRecord(result)) return total;
			return (
				total + (Array.isArray(result.hits) ? result.hits.length : 0)
			);
		}, 0);

		const done = part.state === "output-available";
		const listedCount =
			typeof currentResults?.start === "number" &&
			typeof currentResults?.end === "number" &&
			currentResults.start > 0
				? currentResults.end - currentResults.start + 1
				: 0;

		return {
			toolName,
			title: isListing
				? done
					? "Read current results"
					: "Reading current results"
				: isCurrentResultsSearch
					? done
						? "Searched current results"
						: "Searching current results"
					: "Library search",
			items,
			currentResults,
			detail: done
				? isListing
					? `${listedCount} ${listedCount === 1 ? "entry" : "entries"} in displayed order`
					: `${resultCount} ${resultCount === 1 ? "result" : "results"} across ${results.length} ${results.length === 1 ? "query" : "queries"}`
				: undefined,
			error,
		};
	}

	if (toolName === "readPublications") {
		return {
			toolName,
			title: "Reading publications",
			items: stringArray(input?.itemKeys),
			error,
		};
	}

	return {
		toolName,
		title: toolName,
		items: [],
		detail: error ? undefined : "No additional details.",
		error,
	};
}
