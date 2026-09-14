"use client";

import { useState } from "react";
import { Autocomplete, AutocompleteItem, Chip } from "@nextui-org/react";
import {
	Cancel01Icon,
	Globe02Icon,
	PencilIcon,
	TextSearchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { Button } from "@/components/nextui/Button";
import { filledInputSlots } from "@/components/nextui/field-styles";
import {
	countryFocusNames as countryNames,
	findCountryFocusOptions,
	countryFocusSchema,
	resolveCountryFocus,
} from "@/lib/country-focus";
import { InspectorChoices } from "./InspectorChoices";

export function CountryFocusInput({
	title,
	abstract,
	value,
	onChange,
	disabled = false,
}: {
	title: string;
	abstract: string;
	value: string[] | null;
	onChange: (value: string[] | null) => void;
	disabled?: boolean;
}) {
	const mode = value === null ? "automatic" : "manual";
	const inferred = resolveCountryFocus({ title, abstractNote: abstract });
	const [previousManual, setPreviousManual] = useState<string[] | null>(null);
	const [query, setQuery] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const selected = value ?? inferred;
	const updateManual = (next: string[]) =>
		onChange(countryFocusSchema.parse(next));
	const options = findCountryFocusOptions(query, selected);
	return (
		<section
			aria-label="Country focus"
			className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]"
		>
			<InspectorChoices
				label="Country focus mode"
				value={mode}
				disabled={disabled}
				onChange={(next) => {
					if (next === mode) return;
					if (next === "automatic") {
						setPreviousManual(value);
						onChange(null);
					} else updateManual(previousManual ?? inferred);
					setQuery("");
					setSelectedKey(null);
				}}
				options={[
					{
						key: "automatic",
						label: "Automatic",
						content: (
							<>
								<HugeiconsIcon
									icon={TextSearchIcon}
									size={15}
									aria-hidden
								/>
								Automatic
							</>
						),
					},
					{
						key: "manual",
						label: "Manual",
						content: (
							<>
								<HugeiconsIcon
									icon={PencilIcon}
									size={14}
									aria-hidden
								/>
								Manual
							</>
						),
					},
				]}
			/>
			<div className="space-y-3 px-3.5 pb-3.5 pt-3">
				<p className="text-xs leading-relaxed text-black/50 dark:text-white/50">
					{mode === "automatic"
						? "From the title and abstract. Updates as you edit."
						: "Choose the countries this item focuses on."}
				</p>
				{selected.length > 0 && <div
					aria-label={
						mode === "automatic"
							? "Detected countries"
							: "Selected countries"
					}
					className="flex min-h-8 flex-wrap items-center gap-1.5"
					aria-live="polite"
				>
					{selected.map((code) => (
							<Chip
								key={code}
								size="sm"
								variant="flat"
								classNames={{
									base: "h-auto min-h-8 max-w-full rounded-lg bg-black/[0.045] py-1 pl-2 dark:bg-white/[0.06]",
									content: "min-w-0 text-xs",
								}}
								startContent={
									<CountryFlag
										countryCode={code}
										className="h-3 w-4"
									/>
								}
								endContent={
									mode === "manual" && !disabled ? (
										<Button
											isIconOnly
											size="xs"
											variant="transparent"
											className="!h-5 !w-5 shrink-0 rounded-md text-black/45 dark:text-white/45"
											aria-label={`Remove ${countryNames[code]}`}
											onPress={() =>
												updateManual(
													selected.filter(
														(entry) =>
															entry !== code,
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
									) : undefined
								}
							>
								<span>{countryNames[code]}</span>
							</Chip>
					))}
				</div>}
				{mode === "manual" && (
					<Autocomplete
						aria-label="Add a country"
						isDisabled={disabled}
						placeholder="Find a country"
						inputProps={{
							classNames: {
								input: "text-sm",
								inputWrapper: `h-10 min-h-10 rounded-xl ${filledInputSlots.inputWrapper}`,
							},
						}}
						items={options}
						inputValue={query}
						selectedKey={selectedKey}
						onInputChange={(value) => {
							setQuery(value);
							setSelectedKey(null);
						}}
						onSelectionChange={(value) => {
							if (
								typeof value !== "string" ||
								selected.includes(value)
							)
								return;
							updateManual([...selected, value]);
							setQuery("");
							setSelectedKey(value);
						}}
						menuTrigger="focus"
						startContent={
							<HugeiconsIcon
								icon={Globe02Icon}
								size={16}
								className="text-black/40 dark:text-white/40"
								aria-hidden
							/>
						}
						showScrollIndicators={false}
						scrollShadowProps={{ isEnabled: false }}
						popoverProps={{ shadow: "sm" }}
						listboxProps={{
							emptyContent: "No matching countries.",
						}}
					>
						{({ code, name }) => (
							<AutocompleteItem
								key={code}
								textValue={name}
								startContent={
									<CountryFlag
										countryCode={code}
										className="h-3 w-4"
									/>
								}
								classNames={{ title: "text-sm" }}
							>
								{name}
							</AutocompleteItem>
						)}
					</Autocomplete>
				)}
			</div>
		</section>
	);
}
