"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Add01Icon, ArrowDown01Icon, Cancel01Icon, Delete02Icon, FilterIcon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { useMemo, useState } from "react";
import { ZodError } from "zod";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import {
	ADMIN_ITEM_LIST_COLUMNS,
	getAdminItemListColumn,
	parseAdminItemFilters,
	type AdminItemColumnId,
	type AdminItemFilter,
	type AdminItemFilterOperator,
} from "@/lib/admin/item-list-contract";
import type { AdminItemListRow, AdminSource } from "@/lib/admin/types";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import type { AdminSchemaDefinition } from "./admin-schema";
import { humanizeAdminField } from "./admin-schema";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";
import { useFinePointer } from "@/hooks/useBreakpoint";
import { Tooltip } from "@/components/nextui/Tooltip";

const OPERATOR_LABELS: Record<AdminItemFilterOperator, string> = {
	after: "After",
	anyOf: "Is any of",
	before: "Before",
	between: "Between",
	contains: "Contains",
	equals: "Equals",
	hasNoValue: "Is empty",
	hasValue: "Has a value",
};

type FilterOption = { key: string; label: string };

function selectedKey(keys: "all" | Set<React.Key>) {
	if (keys === "all") return null;
	const value = [...keys][0];
	return typeof value === "string" ? value : null;
}

function initialValue(
	column: AdminItemColumnId,
	operator: AdminItemFilterOperator,
) {
	if (operator === "hasNoValue" || operator === "hasValue") return undefined;
	if (operator === "anyOf") return [];
	if (operator === "between") return ["", ""];
	if (getAdminItemListColumn(column).kind === "number") return "";
	return "";
}

function newFilter(column: AdminItemColumnId): AdminItemFilter {
	const definition = getAdminItemListColumn(column);
	const operator = definition.filterOperators[0]!;
	return { column, operator, value: initialValue(column, operator) };
}

function optionsForColumn(
	column: AdminItemColumnId,
	definitions: readonly AdminSchemaDefinition[],
	items: readonly AdminItemListRow[],
	sources: readonly AdminSource[],
): FilterOption[] {
	switch (column) {
		case "kind":
			return ["created", "imported"].map((key) => ({ key, label: humanizeAdminField(key) }));
		case "state":
			return ["draft", "edited", "published", "deleted"].map((key) => ({
				key,
				label: humanizeAdminField(key),
			}));
		case "fileState":
			return ["none", "unpublished", "processing", "staged", "published"].map((key) => ({
				key,
				label: key === "none" ? "No PDF" : key === "unpublished" ? "Not published" : humanizeAdminField(key),
			}));
		case "itemType":
			return definitions.map(({ itemType }) => ({
				// Zotero names a type "report"; a saved record holds the library's name for it, "Report".
				key: itemType[0]!.toUpperCase() + itemType.slice(1),
				label: humanizeAdminField(itemType),
			}));
		case "source":
			return sources.map(({ key, label }) => ({ key, label }));
		case "tags":
			return [...new Set(items.flatMap(({ tags }) => tags))]
				.toSorted((left, right) => left.localeCompare(right))
				.map((key) => ({ key, label: key }));
		default:
			return [];
	}
}

function CollectionFilterValueEditor({
	errorId,
	onChange,
	selectedValues,
	sources,
}: {
	errorId?: string;
	onChange: (value: unknown) => void;
	selectedValues: string[];
	sources: readonly AdminSource[];
}) {
	const finePointer = useFinePointer();
	const [open, setOpen] = useState(false);
	const { entries } = useResolvedAdminCollections(selectedValues);
	const labels = new Map(entries.map((entry) => [entry.key, entry.name]));
	return (
		<div className="w-full" data-admin-collection-filter-picker>
			<button
				aria-describedby={errorId}
				aria-expanded={open}
				aria-label="Collection values"
				className="flex h-9 w-full items-center gap-2 rounded-lg border border-black/10 bg-black/[0.025] px-3 text-left text-xs text-black/75 outline-none transition-colors hover:bg-black/[0.045] focus-visible:ring-2 focus-visible:ring-focus dark:border-white/10 dark:bg-white/[0.045] dark:text-white/80 dark:hover:bg-white/[0.07]"
				onClick={() => setOpen((current) => !current)}
				type="button"
			>
				<span className="min-w-0 flex-1 truncate">
					{selectedValues.length > 0
						? selectedValues
								.map((key) => labels.get(key) ?? key)
								.join(", ")
						: "Choose collections"}
				</span>
				<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} size={13} />
			</button>
			{open ? (
				<div className="mt-1.5 rounded-xl bg-black/[0.02] p-1.5 dark:bg-white/[0.025]">
					<AdminCollectionPicker
						autoFocus={finePointer}
						lockDeletedSelections={false}
						onSelectionChange={onChange}
						selectedKeys={selectedValues}
						selectionMode="multiple"
						sources={sources}
					/>
				</div>
			) : null}
		</div>
	);
}

function FilterValueEditor({
	definitions,
	filter,
	errorId,
	items,
	onChange,
	sources,
}: {
	definitions: readonly AdminSchemaDefinition[];
	errorId?: string;
	filter: AdminItemFilter;
	items: readonly AdminItemListRow[];
	onChange: (value: unknown) => void;
	sources: readonly AdminSource[];
}) {
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [customValue, setCustomValue] = useState("");
	if (filter.operator === "hasNoValue" || filter.operator === "hasValue") {
		return null;
	}
	const definition = getAdminItemListColumn(filter.column);
	if (filter.operator === "anyOf" && filter.column === "collections") {
		return (
			<CollectionFilterValueEditor
				errorId={errorId}
				onChange={onChange}
				selectedValues={
					Array.isArray(filter.value) ? filter.value.map(String) : []
				}
				sources={sources}
			/>
		);
	}
	const options = optionsForColumn(
		filter.column,
		definitions,
		items,
		sources,
	);
	if (filter.operator === "anyOf") {
		const selectedValues = Array.isArray(filter.value)
			? filter.value.map(String)
			: [];
		const selected = new Set(selectedValues);
		const selectedLabels = selectedValues.map(
			(value) => options.find(({ key }) => key === value)?.label ?? value,
		);
		const renderedOptions = [
			...options,
			...selectedValues
				.filter((value) => !options.some(({ key }) => key === value))
				.map((value) => ({ key: value, label: value })),
		];
		const addCustomValue = () => {
			const value = customValue.trim();
			if (!value || selected.has(value)) return;
			onChange([...selectedValues, value]);
			setCustomValue("");
		};
		return (
			<div className="w-full min-w-0">
				<button
					aria-describedby={errorId}
					aria-expanded={optionsOpen}
					aria-label={`${definition.label} values`}
					className="flex h-9 w-full items-center gap-2 rounded-lg border border-black/10 bg-black/[0.025] px-3 text-left text-xs text-black/75 outline-none transition-colors hover:bg-black/[0.045] focus-visible:ring-2 focus-visible:ring-focus dark:border-white/10 dark:bg-white/[0.045] dark:text-white/80 dark:hover:bg-white/[0.07]"
					onClick={() => setOptionsOpen((current) => !current)}
					type="button"
				>
					<span className="min-w-0 flex-1 truncate">
						{selectedLabels.length > 0
							? selectedLabels.join(", ")
							: "Choose values"}
					</span>
					<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden className={`shrink-0 transition-transform ${optionsOpen ? "rotate-180" : ""}`} size={13} />
				</button>
				{optionsOpen ? (
					<div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-black/[0.08] bg-black/[0.02] p-2 dark:border-white/[0.08] dark:bg-white/[0.025]">
						<div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
							{renderedOptions.map(({ key, label }) => (
								<Checkbox
									key={key}
									aria-label={label}
									className="m-0 min-h-8 max-w-full p-1"
									classNames={{
										label: "truncate text-xs text-black/65 dark:text-white/65",
										wrapper: "me-2",
									}}
									isSelected={selected.has(key)}
									onValueChange={(checked) =>
										onChange(
											checked
												? [...selectedValues, key]
												: selectedValues.filter(
														(value) =>
															value !== key,
													),
										)
									}
									size="sm"
								>
									{label}
								</Checkbox>
							))}
						</div>
						{filter.column === "tags" ? (
							<div className="mt-2 flex items-center gap-2 border-t border-black/[0.06] pt-2 dark:border-white/[0.06]">
								<Input
									aria-label="Add tag value"
									className="min-w-0 flex-1"
									classNames={{
										input: "text-xs",
										inputWrapper: "h-8 min-h-8 rounded-md",
									}}
									placeholder="Add tag"
									value={customValue}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addCustomValue();
										}
									}}
									onValueChange={setCustomValue}
								/>
								<Button
									aria-label="Add tag"
									isDisabled={!customValue.trim()}
									onPress={addCustomValue}
									size="xs"
									variant="transparent"
								>
									Add
								</Button>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		);
	}
	if (filter.operator === "between") {
		const values = Array.isArray(filter.value) ? filter.value : ["", ""];
		const inputType = definition.kind === "date" ? "date" : "number";
		return (
			<div className="flex w-full min-w-0 items-center gap-2">
				{[0, 1].map((index) => (
					<Input
						key={index}
						aria-label={`${definition.label} ${index === 0 ? "minimum" : "maximum"}`}
						aria-describedby={errorId}
						classNames={{
							input: "text-xs",
							inputWrapper: "h-9 min-h-9 rounded-lg",
						}}
						type={inputType}
						isInvalid={Boolean(errorId)}
						value={String(values[index] ?? "")}
						onValueChange={(value) => {
							const next = [...values];
							next[index] =
								definition.kind === "number" && value
									? Number(value)
									: value;
							onChange(next);
						}}
					/>
				))}
			</div>
		);
	}
	return (
		<Input
			aria-label={`${definition.label} value`}
			aria-describedby={errorId}
			className="w-full min-w-0"
			classNames={{
				input: "text-xs",
				inputWrapper: "h-9 min-h-9 rounded-lg",
			}}
			type={
				definition.kind === "date"
					? "date"
					: definition.kind === "number"
						? "number"
						: "text"
			}
			isInvalid={Boolean(errorId)}
			value={filter.value === undefined ? "" : String(filter.value)}
			onValueChange={(value) =>
				onChange(
					definition.kind === "number" && value
						? Number(value)
						: value,
				)
			}
		/>
	);
}

export function AdminItemFilters({
	definitions,
	filters,
	items,
	onChange,
	sources,
}: {
	definitions: readonly AdminSchemaDefinition[];
	filters: readonly AdminItemFilter[];
	items: readonly AdminItemListRow[];
	onChange: (filters: AdminItemFilter[]) => void;
	sources: readonly AdminSource[];
}) {
	const [open, setOpen] = useState(false);
	const [drafts, setDrafts] = useState<AdminItemFilter[]>([...filters]);
	const validation = useMemo(() => {
		try {
			return {
				errors: new Map<number, string>(),
				parsed: parseAdminItemFilters(drafts),
			};
		} catch (error) {
			const errors = new Map<number, string>();
			if (error instanceof ZodError) {
				for (const issue of error.issues) {
					const index = issue.path[0];
					if (typeof index === "number" && !errors.has(index)) {
						errors.set(index, issue.message);
					}
				}
			}
			return { errors, parsed: null };
		}
	}, [drafts]);
	const { errors: filterErrors, parsed } = validation;
	const availableColumns = ADMIN_ITEM_LIST_COLUMNS.filter(
		({ filterable, id }) =>
			filterable && !drafts.some((entry) => entry.column === id),
	);
	const applyFilters = () => {
		if (!parsed) return;
		onChange(parsed);
		setOpen(false);
	};

	return (
		<Popover
			disableAnimation
			isOpen={open}
			placement="bottom-start"
			onOpenChange={(nextOpen) => {
				if (nextOpen) setDrafts([...filters]);
				setOpen(nextOpen);
			}}
		>
			<Tooltip content={filters.length > 0 ? `${filters.length} active filters` : "Filter records"}>
				<span className="inline-flex">
					<PopoverTrigger>
						<button
							aria-expanded={open}
							aria-label={
								filters.length > 0
									? `Filters, ${filters.length} active`
									: "Filters"
							}
							className={`relative grid size-10 shrink-0 place-items-center rounded-xl border text-black/55 shadow-filter-control transition-filter-control hover:text-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/55 dark:shadow-filter-control-dark dark:hover:text-white/85 ${
								filters.length > 0
									? "border-accent/40 bg-accent/[0.09] text-black/75 hover:border-accent/55 hover:bg-accent/[0.14] dark:border-accent/45 dark:bg-accent/[0.16] dark:text-white/85 dark:hover:bg-accent/[0.22]"
									: "border-black/[0.08] bg-black/[0.025] hover:border-black/[0.12] hover:bg-black/[0.05] dark:border-white/[0.09] dark:bg-white/[0.045] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07]"
							}`}
							data-active={filters.length > 0 ? "true" : "false"}
							data-admin-filter-trigger
							type="button"
						>
							<HugeiconsIcon icon={FilterIcon} aria-hidden data-admin-filter-trigger-icon data-admin-filter-trigger-glyph="list-filter" size={17} strokeWidth={2.1} />
							{filters.length > 0 ? (
								<span
									className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background_light dark:ring-background"
									data-admin-filter-trigger-count
								>
									{filters.length}
								</span>
							) : null}
						</button>
					</PopoverTrigger>
				</span>
			</Tooltip>
			<PopoverContent
				aria-label="Filter records"
				as="form"
				// fallow-ignore-next-line css-token-drift -- Uses the shared width token; theme() lets NextUI replace its default w-full.
				className="box-border flex max-h-admin-filter w-[theme(width.admin-filter)] min-w-0 max-w-none flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card"
				data-admin-filter-popover
				onSubmit={(event) => {
					event.preventDefault();
					applyFilters();
				}}
			>
				<div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
					<span className="text-sm font-semibold text-black/80 dark:text-white/85">
						Filter records
					</span>
					{drafts.length > 0 ? (
						<Button
							onPress={() => setDrafts([])}
							size="xs"
							startContent={<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={13} />}
							variant="transparent"
						>
							Clear
						</Button>
					) : null}
				</div>
				<div
					className="min-h-0 w-full flex-1 overflow-y-auto"
					data-admin-filter-scroll
				>
					<div className="space-y-2 p-2" data-admin-filter-list>
						{drafts.length === 0 ? (
							<div className="flex min-h-24 items-center justify-center rounded-lg bg-black/[0.025] text-sm font-medium text-black/45 dark:bg-white/[0.025] dark:text-white/45">
								<span>No filters yet</span>
							</div>
						) : null}
						{drafts.map((filter, index) => {
							const definition = getAdminItemListColumn(
								filter.column,
							);
							const error = filterErrors.get(index);
							const errorId = error
								? `admin-filter-${index}-error`
								: undefined;
							const hasValueEditor =
								filter.operator !== "hasNoValue" &&
								filter.operator !== "hasValue";
							const setFilterValue = (value: unknown) =>
								setDrafts((current) =>
									current.map((entry, entryIndex) =>
										entryIndex === index
											? { ...entry, value }
											: entry,
									),
								);
							return (
								<div
									key={`${filter.column}:${index}`}
									className="grid grid-cols-filter-rule items-start gap-2 rounded-lg border border-black/[0.06] bg-black/[0.02] p-2 dark:border-white/[0.07] dark:bg-white/[0.025]"
									data-admin-filter-row
								>
									<Select
										aria-label={`Filter ${index + 1} field`}
										className="w-full min-w-0"
										classNames={{
											trigger: "h-9 min-h-9 rounded-lg",
											value: "text-xs",
										}}
										placement="left"
										selectedKeys={new Set([filter.column])}
										size="sm"
										onSelectionChange={(keys) => {
											const column = selectedKey(
												keys as Set<React.Key>,
											) as AdminItemColumnId | null;
											if (!column) return;
											setDrafts((current) =>
												current.map(
													(entry, entryIndex) =>
														entryIndex === index
															? newFilter(column)
															: entry,
												),
											);
										}}
									>
										{ADMIN_ITEM_LIST_COLUMNS.filter(
											({ filterable, id }) =>
												filterable &&
												(id === filter.column ||
													!drafts.some(
														(entry) =>
															entry.column === id,
													)),
										).map(({ id, label }) => (
											<SelectItem key={id}>
												{label}
											</SelectItem>
										))}
									</Select>
									<Select
										aria-label={`${definition.label} operator`}
										className="w-full min-w-0"
										classNames={{
											trigger: "h-9 min-h-9 rounded-lg",
											value: "text-xs",
										}}
										placement="left"
										selectedKeys={
											new Set([filter.operator])
										}
										size="sm"
										onSelectionChange={(keys) => {
											const operator = selectedKey(
												keys as Set<React.Key>,
											) as AdminItemFilterOperator | null;
											if (!operator) return;
											setDrafts((current) =>
												current.map(
													(entry, entryIndex) =>
														entryIndex === index
															? {
																	...entry,
																	operator,
																	value: initialValue(
																		entry.column,
																		operator,
																	),
																}
															: entry,
												),
											);
										}}
									>
										{definition.filterOperators.map(
											(operator) => (
												<SelectItem key={operator}>
													{OPERATOR_LABELS[operator]}
												</SelectItem>
											),
										)}
									</Select>
									<Button
										aria-label={`Remove ${definition.label} filter`}
										className="h-9 min-h-9 w-8 min-w-8"
										isIconOnly
										onPress={() =>
											setDrafts((current) =>
												current.filter(
													(_, entryIndex) =>
														entryIndex !== index,
												),
											)
										}
										size="xs"
										variant="transparent"
									>
										<HugeiconsIcon icon={Delete02Icon} aria-hidden size={14} />
									</Button>
									{hasValueEditor ? (
										<div className="col-span-full min-w-0">
											<FilterValueEditor
												definitions={definitions}
												errorId={errorId}
												filter={filter}
												items={items}
												sources={sources}
												onChange={setFilterValue}
											/>
										</div>
									) : null}
									{error ? (
										<p
											id={errorId}
											className="col-span-full px-1 text-xs text-danger"
											role="alert"
										>
											{error}
										</p>
									) : null}
								</div>
							);
						})}
					</div>
				</div>
				<div className="flex min-h-12 shrink-0 flex-wrap items-center justify-end gap-2 border-t border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
					<Select
						aria-label="Add filter"
						className="mr-auto w-40"
						classNames={{
							trigger: "h-9 min-h-9 rounded-lg",
							value: "text-xs",
						}}
						isDisabled={availableColumns.length === 0}
						placeholder="Add filter"
						placement="left"
						selectedKeys={new Set()}
						size="sm"
						startContent={<HugeiconsIcon icon={Add01Icon} aria-hidden size={13} />}
						onSelectionChange={(keys) => {
							const column = selectedKey(
								keys as Set<React.Key>,
							) as AdminItemColumnId | null;
							if (column)
								setDrafts((current) => [
									...current,
									newFilter(column),
								]);
						}}
					>
						{availableColumns.map(({ id, label }) => (
							<SelectItem key={id}>{label}</SelectItem>
						))}
					</Select>
					<Button
						onPress={() => setOpen(false)}
						size="xs"
						type="button"
						variant="transparent"
					>
						Cancel
					</Button>
					<Button
						color="accent"
						isDisabled={!parsed}
						size="xs"
						type="submit"
						variant="solid"
					>
						Apply
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
