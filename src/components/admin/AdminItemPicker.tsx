"use client";

import { Spinner } from "@nextui-org/react";
import { Search } from "lucide-react";
import { useRef, useState } from "react";

import { Input } from "@/components/nextui/Input";
import type { AdminItemListRow, AdminLinkTarget } from "@/lib/admin/types";

import { getAdminItems } from "./admin-api";
import { pickableLinkTargets } from "./admin-links";

const SEARCH_DELAY_MS = 250;
const PAGE_SIZE = 20;

/**
 * Search box + result list used to pick another library record.
 * Searches through the admin record list endpoint; only records that exist as
 * published rows can be linked, so drafts-only and removed records are excluded.
 */
export function AdminItemPicker({
	autoFocus,
	excludeKeys,
	onPick,
	selfKey,
}: {
	autoFocus?: boolean;
	excludeKeys: readonly string[];
	onPick: (target: AdminLinkTarget) => void;
	selfKey: string;
}) {
	const [query, setQuery] = useState("");
	const [rows, setRows] = useState<AdminItemListRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [highlighted, setHighlighted] = useState(0);
	const requestVersion = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const controller = useRef<AbortController | null>(null);

	const search = (value: string) => {
		setQuery(value);
		setHighlighted(0);
		if (timer.current) clearTimeout(timer.current);
		controller.current?.abort();
		const trimmed = value.trim();
		if (!trimmed) {
			setRows([]);
			setLoading(false);
			setError(null);
			return;
		}
		setLoading(true);
		timer.current = setTimeout(() => {
			const version = ++requestVersion.current;
			const abort = new AbortController();
			controller.current = abort;
			getAdminItems(
				new URLSearchParams({
					filters: JSON.stringify([
						{
							column: "state",
							operator: "anyOf",
							value: ["published", "edited"],
						},
					]),
					pageSize: String(PAGE_SIZE),
					requestedColumns: JSON.stringify(["title", "itemType", "state"]),
					search: trimmed,
					sorting: JSON.stringify([{ column: "updated", direction: "desc" }]),
				}),
				abort.signal,
			)
				.then((page) => {
					if (version !== requestVersion.current) return;
					setRows(page.items);
					setError(null);
					setLoading(false);
				})
				.catch((caught: unknown) => {
					if (abort.signal.aborted || version !== requestVersion.current) return;
					setError(
						caught instanceof Error ? caught.message : "Search failed.",
					);
					setLoading(false);
				});
		}, SEARCH_DELAY_MS);
	};

	const options = pickableLinkTargets(rows, { excludeKeys, selfKey });
	const pick = (row: AdminItemListRow) => {
		onPick({
			deleted: row.state === "deleted",
			itemType: row.itemType,
			key: row.key,
			title: row.title?.trim() || "Untitled record",
		});
	};

	return (
		<div className="space-y-2" data-admin-item-picker>
			<Input
				aria-label="Search records to link"
				autoFocus={autoFocus}
				classNames={{ input: "text-sm", inputWrapper: "h-10 min-h-10 rounded-xl" }}
				placeholder="Search records by title, author or key"
				startContent={<Search aria-hidden size={14} />}
				value={query}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setHighlighted((current) =>
							Math.min(current + 1, Math.max(options.length - 1, 0)),
						);
					} else if (event.key === "ArrowUp") {
						event.preventDefault();
						setHighlighted((current) => Math.max(current - 1, 0));
					} else if (event.key === "Enter") {
						event.preventDefault();
						const row = options[highlighted];
						if (row) pick(row);
					}
				}}
				onValueChange={search}
			/>
			{error ? (
				<p className="text-xs text-danger" role="alert">
					{error}
				</p>
			) : null}
			{loading ? (
				<div className="grid min-h-10 place-items-center">
					<Spinner label="Searching records" size="sm" />
				</div>
			) : !query.trim() ? (
				<p className="text-xs text-black/40 dark:text-white/40">
					Type to search the library.
				</p>
			) : options.length === 0 ? (
				<p className="text-xs text-black/40 dark:text-white/40" role="status">
					No matching records.
				</p>
			) : (
				<ul
					aria-label="Matching records"
					className="max-h-72 space-y-1 overflow-y-auto"
					role="listbox"
				>
					{options.map((row, index) => (
						<li
							key={row.key}
							aria-selected={index === highlighted}
							role="option"
						>
							<button
								className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.07] ${
									index === highlighted
										? "bg-black/[0.05] dark:bg-white/[0.07]"
										: ""
								}`}
								data-admin-picker-key={row.key}
								onClick={() => pick(row)}
								onMouseEnter={() => setHighlighted(index)}
								type="button"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">
										{row.title?.trim() || "Untitled record"}
									</span>
									<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
										{row.itemType} · {row.key}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
