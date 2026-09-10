"use client";

import { useEffect, useState } from "react";
import useSWRInfinite from "swr/infinite";
import {
	Autocomplete,
	AutocompleteItem,
	Chip,
	Spinner,
} from "@nextui-org/react";
import {
	Add01Icon,
	ArrowDown01Icon,
	Building03Icon,
	Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	formatInstitutionNames,
	hasInstitution,
	parseInstitutionNames,
} from "@/config/library-config/institutions";
import { useDebounce } from "@/hooks/useDebounce";
import type { OpenScholarInstitutionPage } from "@/lib/admin/openscholar-institutions";
import { fetchAdminInstitutions } from "./admin-api";

export function InstitutionInput({
	value,
	onValueChange,
	id,
	label,
	disabled,
	error,
}: {
	value: string;
	onValueChange: (value: string) => void;
	id: string;
	label: string;
	disabled: boolean;
	error?: string;
}) {
	const names = parseInstitutionNames(value);
	const [input, setInput] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const { query, setQuery, search, cancelSearch } = useInstitutionQuery();
	const searchText = input.trim().slice(0, 200);
	const pendingSearch = searchText !== query;
	const {
		data,
		error: catalogError,
		isLoading,
		isValidating,
		size,
		setSize,
		mutate,
	} = useSWRInfinite<OpenScholarInstitutionPage>(
		(index, previous: OpenScholarInstitutionPage | null) => {
			if (!open || disabled || (index > 0 && !previous?.nextCursor))
				return null;
			return [
				"admin-institutions",
				query,
				index === 0 ? null : previous!.nextCursor,
			];
		},
		([, term, cursor]: [string, string, string | null]) =>
			fetchAdminInstitutions(term, cursor),
		{
			revalidateOnFocus: false,
			revalidateFirstPage: false,
			shouldRetryOnError: false,
		},
	);
	const results = pendingSearch
		? []
		: (data?.flatMap((page) => page.items) ?? []);
	const { options, canAdd, existing } = institutionOptions(
		results,
		names,
		input,
	);
	const updateInput = (next: string) => {
		setSelectedKey(null);
		setInput(next);
		if (!next.trim()) {
			cancelSearch();
			setQuery("");
		} else search(next.trim().slice(0, 200));
	};
	const add = (name: string, key = "create") => {
		if (!name.trim()) return;
		onValueChange(formatInstitutionNames([...names, name]));
		updateInput("");
		setSelectedKey(key);
	};

	return (
		<div className="space-y-2" data-field-kind="institution-list">
			{names.length > 0 && (
				<div
					className="flex flex-wrap gap-1.5"
					aria-label={`${label} selected`}
				>
					{names.map((name) => (
						<Chip
							key={name}
							size="sm"
							variant="flat"
							classNames={{
								base: "h-auto min-h-8 max-w-full rounded-lg bg-black/[0.045] py-1 pl-2 dark:bg-white/[0.06]",
								content: "min-w-0 truncate text-xs",
							}}
							startContent={
								<HugeiconsIcon
									icon={Building03Icon}
									size={14}
									className="shrink-0 text-black/45 dark:text-white/45"
									aria-hidden
								/>
							}
							endContent={
								disabled ? undefined : (
									<Button
										isIconOnly
										size="xs"
										variant="transparent"
										className="!h-5 !w-5 shrink-0 rounded-md text-black/45 dark:text-white/45"
										aria-label={`Remove ${name}`}
										onPress={() =>
											onValueChange(
												formatInstitutionNames(
													names.filter(
														(entry) =>
															entry !== name,
													),
												),
											)
										}
									>
										<HugeiconsIcon
											icon={Cancel01Icon}
											size={12}
											aria-hidden
										/>
									</Button>
								)
							}
						>
							<Tooltip content={name}>
								<span>{name}</span>
							</Tooltip>
						</Chip>
					))}
				</div>
			)}
			<Autocomplete
				id={id}
				aria-label={label}
				inputProps={{
					classNames: {
						input: "text-sm",
						inputWrapper: `h-10 min-h-10 rounded-xl ${filledInputSlots.inputWrapper}`,
					},
					onKeyDownCapture: (event) => {
						if (
							event.key !== "Enter" ||
							event.nativeEvent.isComposing
						)
							return;
						const target = event.target;
						if (
							target instanceof HTMLElement &&
							target.getAttribute("aria-activedescendant")
						)
							return;
						event.preventDefault();
						event.stopPropagation();
						if (canAdd) add(existing?.name ?? input);
					},
				}}
				showScrollIndicators={false}
				scrollShadowProps={{ isEnabled: false }}
				popoverProps={{ shadow: "sm" }}
				items={options}
				allowsCustomValue
				isDisabled={disabled}
				errorMessage={error}
				isInvalid={Boolean(error)}
				isLoading={open && (isLoading || isValidating || pendingSearch)}
				inputValue={input}
				selectedKey={selectedKey}
				onInputChange={updateInput}
				onOpenChange={setOpen}
				onSelectionChange={(key) => {
					const option = options.find((item) => item.key === key);
					if (option) add(option.name, option.key);
				}}
				menuTrigger="focus"
				placeholder="Find or add an institution"
				startContent={
					<HugeiconsIcon
						icon={Building03Icon}
						size={16}
						className="shrink-0 text-black/40 dark:text-white/40"
						aria-hidden
					/>
				}
				listboxProps={{
					"aria-label": `${label} suggestions`,
					hideEmptyContent: false,
					emptyContent: (
						<InstitutionEmpty
							loading={isLoading || pendingSearch}
							error={Boolean(catalogError)}
							alreadyAdded={Boolean(input.trim()) && !canAdd}
						/>
					),
					bottomContent: (
						<InstitutionSearchFooter
							error={Boolean(catalogError)}
							hasMore={
								!pendingSearch &&
								Boolean(data?.at(-1)?.nextCursor)
							}
							isValidating={isValidating}
							onRetry={() => void mutate()}
							onMore={() => void setSize(size + 1)}
						/>
					),
				}}
			>
				{(option) => (
					<AutocompleteItem
						key={option.key}
						textValue={option.name}
						startContent={
							<HugeiconsIcon
								icon={
									option.create ? Add01Icon : Building03Icon
								}
								size={16}
								className="shrink-0 text-black/45 dark:text-white/45"
								aria-hidden
							/>
						}
						classNames={{ title: "truncate text-sm" }}
						endContent={
							option.create ? undefined : (
								<span
									className="shrink-0 text-xs tabular-nums text-black/40 dark:text-white/40"
									aria-label={`${option.count} items`}
								>
									{option.count}
								</span>
							)
						}
					>
						{option.create ? `Add "${option.name}"` : option.name}
					</AutocompleteItem>
				)}
			</Autocomplete>
		</div>
	);
}

function institutionOptions(
	results: OpenScholarInstitutionPage["items"],
	names: readonly string[],
	input: string,
) {
	const available = results.filter(
		(item) => !hasInstitution(names, item.name),
	);
	const canAdd =
		Boolean(input.trim()) &&
		!parseInstitutionNames(input).every((name) =>
			hasInstitution(names, name),
		);
	const existing = results.find((item) => hasInstitution([item.name], input));
	const options = [
		...available.map((item) => ({
			key: `existing:${item.name}`,
			...item,
			create: false,
		})),
		...(canAdd && !existing
			? [{ key: "create", name: input.trim(), count: 0, create: true }]
			: []),
	];
	return { options, canAdd, existing };
}

function InstitutionEmpty({
	loading,
	error,
	alreadyAdded,
}: {
	loading: boolean;
	error: boolean;
	alreadyAdded: boolean;
}) {
	return (
		<>
			{loading ? (
				<Spinner size="sm" aria-label="Searching institutions" />
			) : error ? (
				"Institutions could not be loaded."
			) : alreadyAdded ? (
				"Already added to this item"
			) : (
				"Type an institution name to add it."
			)}
		</>
	);
}

function InstitutionSearchFooter({
	error,
	hasMore,
	isValidating,
	onRetry,
	onMore,
}: {
	error: boolean;
	hasMore: boolean;
	isValidating: boolean;
	onRetry: () => void;
	onMore: () => void;
}) {
	return error ? (
		<Button
			size="xs"
			variant="transparent"
			className="w-full"
			onPress={onRetry}
		>
			Retry search
		</Button>
	) : hasMore ? (
		<Button
			size="xs"
			variant="transparent"
			className="h-8 w-full gap-1.5 text-xs"
			isDisabled={isValidating}
			onPress={onMore}
			startContent={
				isValidating ? (
					<Spinner size="sm" />
				) : (
					<HugeiconsIcon
						icon={ArrowDown01Icon}
						size={14}
						aria-hidden
					/>
				)
			}
		>
			More institutions
		</Button>
	) : null;
}

function useInstitutionQuery() {
	const [query, setQuery] = useState("");
	const [search, , cancelSearch] = useDebounce(setQuery, 250);
	useEffect(() => cancelSearch, [cancelSearch]);
	return { query, setQuery, search, cancelSearch };
}
