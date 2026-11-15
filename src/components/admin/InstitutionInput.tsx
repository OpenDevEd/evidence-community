"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import {
	Autocomplete,
	AutocompleteItem,
	AutocompleteSection,
	Chip,
} from "@nextui-org/react";
import { Spinner } from "@/components/nextui/Spinner";
import {
	Add01Icon,
	ArrowDown01Icon,
	Building03Icon,
	Cancel01Icon,
	Delete02Icon,
} from "@hugeicons/core-free-icons";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { OpenAlexIcon } from "@/components/icons/OpenAlexIcon";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import {
	formatInstitutionNames,
	hasInstitution,
	institutionNameKey,
	parseInstitutionNames,
} from "@/config/library-config/institutions";
import { useDebounce } from "@/hooks/useDebounce";
import type {
	AdminInstitutionPage,
	InstitutionCountry,
	OpenAlexInstitution,
} from "@/lib/admin/institution-countries";
import { countryFocusNames, countryFocusOptions } from "@/lib/country-focus";
import {
	fetchAdminInstitutionCountries,
	fetchAdminInstitutions,
	fetchOpenAlexInstitutions,
	saveAdminInstitutionCountry,
} from "./admin-api";

const COUNTRIES_KEY = "admin-institution-countries";
const INSTITUTIONS_KEY = "admin-institutions";
const FLAG = "h-3 w-4";
/** Headings and rows share one key space. The prefix keeps them apart. */
const SECTION_KEY = "section:";

type Option = {
	key: string;
	name: string;
	count: number;
	kind: "library" | "openalex" | "create";
	countryCode?: string;
	match?: OpenAlexInstitution;
};
type Section = {
	key: string;
	title?: string;
	/** Extra heading classes; the heading takes only text, so a logo comes from CSS. */
	headingClassName?: string;
	items: Option[];
};

/** The country, city and location of an institution chosen from OpenAlex. */
const fromOpenAlex = (match: OpenAlexInstitution): InstitutionCountry => ({
	countryCode: match.countryCode,
	openalexId: match.id,
	city: match.city || null,
	latitude: match.latitude,
	longitude: match.longitude,
});

const place = (match: Pick<OpenAlexInstitution, "city" | "countryCode">) =>
	[match.city, match.countryCode && countryFocusNames[match.countryCode]]
		.filter(Boolean)
		.join(", ");

/**
 * A country belongs to the institution name, not to the record, so saving one
 * refreshes every selector that shows the name.
 */
function useInstitutionCountries(names: readonly string[]) {
	const keys = names.map(institutionNameKey).sort();
	const { mutate } = useSWRConfig();
	const [failedName, setFailedName] = useState<string | null>(null);
	const { data } = useSWR(
		keys.length > 0 ? [COUNTRIES_KEY, ...keys] : null,
		() => fetchAdminInstitutionCountries(names),
		// Adding a name changes the key. Known countries must not blink out.
		{ revalidateOnFocus: false, keepPreviousData: true },
	);
	return {
		failedName,
		countryFor: (name: string) => data?.[institutionNameKey(name)],
		openalexIds: new Set(
			Object.values(data ?? {}).map((country) => country.openalexId),
		),
		save: async (name: string, country: InstitutionCountry | null) => {
			setFailedName(null);
			try {
				await saveAdminInstitutionCountry(name, country);
			} catch {
				setFailedName(name);
			}
			await mutate(
				(key) => Array.isArray(key) && key[0] === COUNTRIES_KEY,
			);
			// Cached dropdown pages carry the old flag. Drop them so the next
			// search reads the new one.
			await mutate(
				(key) => Array.isArray(key) && key[0] === INSTITUTIONS_KEY,
				undefined,
				{ revalidate: false },
			);
		},
	};
}

/**
 * OpenAlex rows for a search of three letters or more. `isNew` hides a row the
 * library already has, by name or id.
 */
function useOpenAlexOptions(
	query: string,
	isNew: (match: OpenAlexInstitution) => boolean,
) {
	const wanted = query.length >= 3;
	const { data, error, isLoading } = useSWR(
		wanted ? ["admin-openalex-institutions", query] : null,
		([, term]: [string, string]) => fetchOpenAlexInstitutions(term),
		{ revalidateOnFocus: false, shouldRetryOnError: false },
	);
	const options: Option[] = (data ?? []).filter(isNew).map((match) => ({
		key: `openalex:${match.id}`,
		name: match.name,
		count: 0,
		kind: "openalex",
		countryCode: match.countryCode,
		match,
	}));
	const status = error
		? "OpenAlex could not be reached."
		: isLoading
			? "Searching OpenAlex…"
			: "Nothing more on OpenAlex.";
	return {
		options,
		isLoading: wanted && isLoading,
		note: wanted && options.length === 0 ? status : null,
	};
}

/** The dropdown's rows: the library's own names, then OpenAlex, then "Add". */
function useInstitutionSearch({
	names,
	input,
	open,
	disabled,
	knownOpenAlexIds,
}: {
	names: readonly string[];
	input: string;
	open: boolean;
	disabled: boolean;
	knownOpenAlexIds: ReadonlySet<string | null>;
}) {
	const { query, setQuery, search, cancelSearch } = useInstitutionQuery();
	const pending = input.trim().slice(0, 200) !== query;
	const library = useSWRInfinite<AdminInstitutionPage>(
		(index, previous: AdminInstitutionPage | null) => {
			if (!open || disabled || (index > 0 && !previous?.nextCursor))
				return null;
			return [
				INSTITUTIONS_KEY,
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
	const results = pending
		? []
		: (library.data?.flatMap((page) => page.items) ?? []);
	const { options, canAdd, existing } = institutionOptions(
		results,
		names,
		input,
	);
	const openAlex = useOpenAlexOptions(
		open && !disabled && !pending ? query : "",
		(match) =>
			!hasInstitution(names, match.name) &&
			!hasInstitution(
				results.map((item) => item.name),
				match.name,
			) &&
			!knownOpenAlexIds.has(match.id) &&
			!results.some((item) => item.openalexId === match.id),
	);
	const sections: Section[] = [
		{
			key: `${SECTION_KEY}community`,
			title: "In this community",
			items: options.filter((option) => option.kind === "library"),
		},
		{
			key: `${SECTION_KEY}openalex`,
			title: "From OpenAlex",
			headingClassName:
				"inline-flex items-center gap-1.5 before:size-3 before:shrink-0 before:bg-current before:content-[''] before:[mask:url(/icons/openalex.png)_center/contain_no-repeat]",
			items: openAlex.options,
		},
		{
			key: `${SECTION_KEY}create`,
			items: options.filter((option) => option.kind === "create"),
		},
	].filter((section) => section.items.length > 0);
	return {
		sections,
		canAdd,
		existing,
		pending,
		library,
		openAlexNote: openAlex.note,
		isLoading:
			library.isLoading ||
			library.isValidating ||
			pending ||
			openAlex.isLoading,
		setSearch: (next: string) => {
			if (next) search(next);
			else {
				cancelSearch();
				setQuery("");
			}
		},
	};
}

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
	const countries = useInstitutionCountries(names);
	const [input, setInput] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const found = useInstitutionSearch({
		names,
		input,
		open,
		disabled,
		knownOpenAlexIds: countries.openalexIds,
	});

	const updateInput = (next: string) => {
		setSelectedKey(null);
		setInput(next);
		found.setSearch(next.trim().slice(0, 200));
	};
	const add = (name: string, key = "create") => {
		if (!name.trim()) return;
		onValueChange(formatInstitutionNames([...names, name]));
		updateInput("");
		setSelectedKey(key);
	};
	const choose = (option: Option) => {
		add(option.name, option.key);
		if (option.match?.countryCode)
			void countries.save(option.name, fromOpenAlex(option.match));
	};
	return (
		<div className="space-y-2" data-field-kind="institution-list">
			<InstitutionChips
				id={id}
				label={label}
				names={names}
				disabled={disabled}
				countries={countries}
				onRemove={(name) =>
					onValueChange(
						formatInstitutionNames(
							names.filter((entry) => entry !== name),
						),
					)
				}
				onCountryChange={(name, country) =>
					void countries.save(name, country)
				}
			/>
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
						if (found.canAdd) add(found.existing?.name ?? input);
					},
				}}
				showScrollIndicators={false}
				scrollShadowProps={{ isEnabled: false }}
				popoverProps={{ shadow: "sm" }}
				items={found.sections}
				allowsCustomValue
				isDisabled={disabled}
				errorMessage={error}
				isInvalid={Boolean(error)}
				isLoading={open && found.isLoading}
				inputValue={input}
				selectedKey={selectedKey}
				onInputChange={updateInput}
				onOpenChange={setOpen}
				onSelectionChange={(key) => {
					const option = found.sections
						.flatMap((section) => section.items)
						.find((item) => item.key === key);
					if (option) return choose(option);
					// Enter with no row highlighted reports the heading the
					// list highlights instead. That means "add what I typed":
					// through the row of that exact name when there is one,
					// so its country comes with it.
					if (!String(key).startsWith(SECTION_KEY)) return;
					const typed = institutionNameKey(input);
					const exact = found.sections
						.flatMap((section) => section.items)
						.find(
							(item) =>
								item.kind !== "create" &&
								institutionNameKey(item.name) === typed,
						);
					if (exact) choose(exact);
					else if (found.canAdd) add(found.existing?.name ?? input);
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
							loading={found.library.isLoading || found.pending}
							error={Boolean(found.library.error)}
							alreadyAdded={
								Boolean(input.trim()) && !found.canAdd
							}
						/>
					),
					bottomContent: (
						<>
							{found.openAlexNote && (
								<p className="px-2.5 py-1.5 text-xs text-black/50 dark:text-white/50">
									{found.openAlexNote}
								</p>
							)}
							<InstitutionSearchFooter
								error={Boolean(found.library.error)}
								hasMore={
									!found.pending &&
									Boolean(
										found.library.data?.at(-1)?.nextCursor,
									)
								}
								isValidating={found.library.isValidating}
								onRetry={() => void found.library.mutate()}
								onMore={() =>
									void found.library.setSize(
										found.library.size + 1,
									)
								}
							/>
						</>
					),
				}}
			>
				{(section) => (
					<AutocompleteSection
						key={section.key}
						title={section.title}
						items={section.items}
						classNames={{
							heading: `px-1.5 text-xs text-black/50 dark:text-white/50 ${section.headingClassName ?? ""}`,
						}}
					>
						{(option) => (
							<AutocompleteItem
								key={option.key}
								textValue={option.name}
								description={OPTION_NOTE[option.kind](option)}
								startContent={<OptionMark option={option} />}
								classNames={{
									// The wrapper sizes to its text by default, so
									// nothing truncates until it may shrink.
									wrapper: "min-w-0",
									title: "w-full truncate text-sm",
									description:
										"w-full truncate text-xs text-black/50 dark:text-white/50",
								}}
								endContent={
									option.kind === "library" ? (
										<span
											className="shrink-0 text-xs tabular-nums text-black/40 dark:text-white/40"
											aria-label={`${option.count} items`}
										>
											{option.count}
										</span>
									) : undefined
								}
							>
								{option.kind === "create"
									? `Add "${option.name}"`
									: option.name}
							</AutocompleteItem>
						)}
					</AutocompleteSection>
				)}
			</Autocomplete>
		</div>
	);
}

const OPTION_NOTE: Record<
	Option["kind"],
	(option: Option) => string | undefined
> = {
	library: () => undefined,
	openalex: (option) =>
		(option.match && place(option.match)) || "No location on OpenAlex",
	create: () => "You can set its country afterwards.",
};

function OptionMark({ option }: { option: Option }) {
	return option.countryCode ? (
		<CountryFlag countryCode={option.countryCode} className={FLAG} />
	) : (
		<HugeiconsIcon
			icon={option.kind === "create" ? Add01Icon : Building03Icon}
			size={16}
			className="shrink-0 text-black/45 dark:text-white/45"
			aria-hidden
		/>
	);
}

/** The selected names. A chip opens the panel that explains or sets its country. */
function InstitutionChips({
	id,
	label,
	names,
	disabled,
	countries,
	onRemove,
	onCountryChange,
}: {
	id: string;
	label: string;
	names: readonly string[];
	disabled: boolean;
	countries: ReturnType<typeof useInstitutionCountries>;
	onRemove: (name: string) => void;
	onCountryChange: (name: string, country: InstitutionCountry | null) => void;
}) {
	const [panel, setPanel] = useState<string | null>(null);
	if (names.length === 0) return null;
	return (
		<>
			<div
				className="flex flex-wrap gap-1.5"
				aria-label={`${label} selected`}
			>
				{names.map((name) => {
					const country = countries.countryFor(name);
					return (
						<Chip
							key={name}
							size="sm"
							variant="flat"
							classNames={{
								// NextUI's chip refuses to be narrower than its text.
								// A long name must shrink and truncate instead.
								base: `h-auto min-h-8 min-w-0 max-w-full rounded-lg py-1 pl-1 ${panel === name ? "bg-black/[0.09] dark:bg-white/[0.12]" : "bg-black/[0.045] dark:bg-white/[0.06]"}`,
								content: "min-w-0 truncate px-0 text-xs",
							}}
							endContent={
								disabled ? undefined : (
									<Button
										isIconOnly
										size="xs"
										variant="transparent"
										className="!h-5 !w-5 shrink-0 rounded-md text-black/45 dark:text-white/45"
										aria-label={`Remove ${name}`}
										onPress={() => onRemove(name)}
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
							<button
								type="button"
								aria-expanded={panel === name}
								aria-controls={
									panel === name ? `${id}-country-panel` : undefined
								}
								onClick={() =>
									setPanel(panel === name ? null : name)
								}
								className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
							>
								{country ? (
									<>
										<span aria-hidden className="flex">
											<CountryFlag
												countryCode={country.countryCode}
												className={FLAG}
											/>
										</span>
										<span className="sr-only">
											{countryFocusNames[country.countryCode]}
										</span>
									</>
								) : (
									<HugeiconsIcon
										icon={Building03Icon}
										size={14}
										className="shrink-0 text-black/45 dark:text-white/45"
										aria-hidden
									/>
								)}
								<TruncatedText text={name} />
								{!country && (
									<span className="shrink-0 rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
										No country
									</span>
								)}
							</button>
						</Chip>
					);
				})}
			</div>
			{countries.failedName && (
				<p role="alert" className="text-xs text-danger">
					The country for {countries.failedName} could not be saved.
					Try again.
				</p>
			)}
			{panel && hasInstitution(names, panel) && (
				<InstitutionCountryPanel
					key={panel}
					id={`${id}-country`}
					name={panel}
					country={countries.countryFor(panel)}
					disabled={disabled}
					onChange={(country) => onCountryChange(panel, country)}
				/>
			)}
		</>
	);
}

const PANEL_FRAME =
	"rounded-xl border border-black/[0.08] bg-white p-3 dark:border-white/[0.08] dark:bg-white/[0.04]";
const QUIET = "text-xs text-black/55 dark:text-white/55";

/** Shows where a selected name's country comes from, or lets an editor set it. */
function InstitutionCountryPanel({
	id,
	name,
	country,
	disabled,
	onChange,
}: {
	id: string;
	name: string;
	country: InstitutionCountry | undefined;
	disabled: boolean;
	onChange: (country: InstitutionCountry | null) => void;
}) {
	return (
		<div id={`${id}-panel`} className={PANEL_FRAME}>
			{country ? (
				<KnownCountry
					name={name}
					country={country}
					onRemove={disabled ? undefined : () => onChange(null)}
				/>
			) : (
				<>
					<p className="text-sm font-medium">
						No country yet for {name}
					</p>
					{/* The rest explains a choice. A read-only view offers none. */}
					{!disabled && (
						<>
							<p className={QUIET}>
								This applies to every record that names it. The
								name on the record stays as it is.
							</p>
							<CountryChooser
								id={id}
								name={name}
								onChoose={onChange}
							/>
						</>
					)}
				</>
			)}
		</div>
	);
}

function KnownCountry({
	name,
	country,
	onRemove,
}: {
	name: string;
	country: InstitutionCountry;
	onRemove?: () => void;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<span className="mt-1">
				<CountryFlag
					countryCode={country.countryCode}
					className={FLAG}
				/>
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">
					{countryFocusNames[country.countryCode] ??
						country.countryCode}
				</p>
				<p className={QUIET}>
					{country.openalexId ? (
						<>
							<OpenAlexIcon size={11} className="mr-1 align-[-1px]" />
							From OpenAlex
							{country.city ? `, ${country.city}` : ""}.{" "}
							<a
								className="underline"
								href={`https://openalex.org/${country.openalexId}`}
								target="_blank"
								rel="noreferrer"
							>
								{country.openalexId}
							</a>
							.{" "}
						</>
					) : (
						"Set by hand. "
					)}
					This applies to every record that names it.
				</p>
			</div>
			{onRemove && (
				<Tooltip content="Remove country">
					<Button
						isIconOnly
						aria-label={`Remove country from ${name}`}
						size="xs"
						variant="transparent"
						onPress={onRemove}
						className="-mr-1 -mt-1 size-8 shrink-0 rounded-lg text-black/45 dark:text-white/45"
					>
						<HugeiconsIcon icon={Delete02Icon} size={14} />
					</Button>
				</Tooltip>
			)}
		</div>
	);
}

/** OpenAlex guesses for the name first, then every country. */
function CountryChooser({
	id,
	name,
	onChoose,
}: {
	id: string;
	name: string;
	onChoose: (country: InstitutionCountry) => void;
}) {
	// OpenAlex needs three letters. A shorter name simply has no match.
	const matches = useSWR(
		name.trim().length >= 3 ? ["admin-openalex-institutions", name] : null,
		([, term]: [string, string]) => fetchOpenAlexInstitutions(term),
		{ revalidateOnFocus: false, shouldRetryOnError: false },
	);
	const candidates = (matches.data ?? [])
		.filter((match) => match.countryCode)
		.slice(0, 4);
	return (
		<>
			{candidates.length > 0 && (
				<p className={`mt-3 ${QUIET}`}>Is it one of these?</p>
			)}
			<div className="mt-1">
				{candidates.map((match) => (
					<button
						key={match.id}
						type="button"
						onClick={() => onChoose(fromOpenAlex(match))}
						className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
					>
						<CountryFlag
							countryCode={match.countryCode}
							className={`${FLAG} mt-1 self-start`}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate">{match.name}</span>
							<span className={`block truncate ${QUIET}`}>
								{place(match)}
							</span>
						</span>
					</button>
				))}
				{matches.isLoading && (
					<div className={`flex items-center gap-2 py-2 ${QUIET}`}>
						<Spinner size="sm" aria-label="Looking on OpenAlex" />
						Looking on OpenAlex…
					</div>
				)}
				{!matches.isLoading && candidates.length === 0 && (
					<p className={`mt-2 py-2 ${QUIET}`}>
						{matches.error
							? "OpenAlex could not be reached."
							: "OpenAlex has no match for this name."}
					</p>
				)}
			</div>
			<Autocomplete
				id={id}
				aria-label={`Country for ${name}`}
				className="mt-2"
				size="sm"
				defaultItems={countryFocusOptions}
				placeholder={
					candidates.length > 0
						? "Or choose the country yourself"
						: "Choose the country"
				}
				inputProps={{
					classNames: {
						input: "text-sm",
						inputWrapper: `rounded-lg ${filledInputSlots.inputWrapper}`,
					},
				}}
				onSelectionChange={(key) => {
					if (key)
						onChoose({
							countryCode: String(key),
							openalexId: null,
							city: null,
							latitude: null,
							longitude: null,
						});
				}}
			>
				{(option) => (
					<AutocompleteItem
						key={option.code}
						textValue={option.name}
						startContent={
							<CountryFlag
								countryCode={option.code}
								className={FLAG}
							/>
						}
					>
						{option.name}
					</AutocompleteItem>
				)}
			</Autocomplete>
		</>
	);
}

function institutionOptions(
	results: AdminInstitutionPage["items"],
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
	const options: Option[] = [
		...available.map((item) => ({
			key: `existing:${item.name}`,
			name: item.name,
			count: item.count,
			kind: "library" as const,
			countryCode: item.countryCode,
		})),
		...(canAdd && !existing
			? [
					{
						key: "create",
						name: input.trim(),
						count: 0,
						kind: "create" as const,
					},
				]
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
