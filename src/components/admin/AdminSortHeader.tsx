import { ArrowDown01Icon, ArrowUp01Icon, ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";

/** A column's name as the button that sorts by it, with which way it is sorted. Every admin list sorts this way. */
export function SortHeader<Column extends string>({
	columnId,
	label,
	onSort,
	sort,
	sortDirection,
	tabIndex = -1,
}: {
	columnId: Column;
	label: string;
	onSort: (sort: Column) => void;
	sort: Column;
	sortDirection: "asc" | "desc";
	/**
	 * The record table moves through its header with the arrow keys, so its buttons stay out of the Tab order, and its
	 * column header says which way it is sorted. A plain list has neither: it passes 0, and the button says the order itself.
	 */
	tabIndex?: number;
}) {
	const selected = sort === columnId;
	const Icon = selected
		? sortDirection === "asc"
			? ArrowUp01Icon
			: ArrowDown01Icon
		: ArrowUpDownIcon;
	return (
		<button
			className="flex h-full w-full min-w-0 items-center gap-1.5 text-left hover:text-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus dark:hover:text-white/70"
			onClick={() => onSort(columnId)}
			tabIndex={tabIndex}
			type="button"
		>
			<span className="truncate">{label}</span>
			{tabIndex === 0 && selected && <span className="sr-only">{sortDirection === "asc" ? ", sorted ascending" : ", sorted descending"}</span>}
			<HugeiconsIcon
				icon={Icon}
				aria-hidden
				className={
					selected ? "shrink-0 opacity-80" : "shrink-0 opacity-30"
				}
				size={12}
			/>
		</button>
	);
}
