"use client";

import Link from "next/link";
import {
	PiFilePdfBold,
	PiFunnelSimpleBold,
	PiMagnifyingGlassBold,
	PiWrenchBold,
} from "react-icons/pi";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/Tool";
import {
	toolActivitySummary,
	type ResearchToolPart,
} from "@/lib/ai/tool-activity";

function SearchDetails({ part }: { part: ResearchToolPart }) {
	const summary = toolActivitySummary(part);

	return (
		<div className="space-y-1.5">
			{summary.currentResults && (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-black/45 dark:text-white/45">
					<span className="inline-flex items-center gap-1.5 font-medium text-black/55 dark:text-white/55">
						<PiFunnelSimpleBold
							className="size-3"
							aria-hidden="true"
						/>
						Current results only
					</span>
					<span>
						{summary.currentResults.start !== undefined &&
						summary.currentResults.end !== undefined &&
						summary.currentResults.total !== undefined
							? summary.currentResults.end === 0
								? "No results in this window"
								: `${summary.currentResults.start}–${summary.currentResults.end} of ${summary.currentResults.total}`
							: "Inspecting up to 200 results"}
					</span>
				</div>
			)}
			{summary.items.length > 0 && (
				<ul className="space-y-0.5 text-black/55 dark:text-white/55">
					{summary.items.map((query) => (
						<li key={query} className="flex gap-1.5">
							<span
								aria-hidden="true"
								className="text-black/25 dark:text-white/25"
							>
								—
							</span>
							<span>{query}</span>
						</li>
					))}
				</ul>
			)}
			{summary.detail && (
				<p className="text-xs text-black/40 dark:text-white/40">
					{summary.detail}
				</p>
			)}
			{summary.error && <p className="text-danger">{summary.error}</p>}
		</div>
	);
}

function PublicationDetails({ part }: { part: ResearchToolPart }) {
	const summary = toolActivitySummary(part);

	return (
		<div className="space-y-1.5">
			{summary.items.length > 0 && (
				<div className="flex flex-wrap gap-x-3 gap-y-1">
					{summary.items.map((itemKey) => (
						<Link
							key={itemKey}
							href={`/lib/${itemKey}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-xs font-medium text-black/55 underline decoration-black/15 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/40 dark:text-white/55 dark:decoration-white/15"
						>
							{itemKey}
						</Link>
					))}
				</div>
			)}
			{summary.error && <p className="text-danger">{summary.error}</p>}
		</div>
	);
}

export function ToolActivity({ part }: { part: ResearchToolPart }) {
	const summary = toolActivitySummary(part);
	const icon =
		summary.toolName === "searchLibrary" ? (
			<PiMagnifyingGlassBold className="size-3.5" aria-hidden="true" />
		) : summary.toolName === "readPublications" ? (
			<PiFilePdfBold className="size-3.5" aria-hidden="true" />
		) : (
			<PiWrenchBold className="size-3.5" aria-hidden="true" />
		);

	return (
		<Tool>
			<ToolHeader title={summary.title} state={part.state} icon={icon} />
			<ToolContent>
				{summary.toolName === "searchLibrary" ? (
					<SearchDetails part={part} />
				) : summary.toolName === "readPublications" ? (
					<PublicationDetails part={part} />
				) : summary.error ? (
					<p className="text-danger">{summary.error}</p>
				) : (
					<p>{summary.detail}</p>
				)}
			</ToolContent>
		</Tool>
	);
}
