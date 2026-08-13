"use client";

import type { ZoteroFieldDescriptor } from "@opendeved/evidence-library-core/zotero-schema";
import { useState } from "react";

import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Textarea } from "@/components/nextui/Textarea";
import {
	ADMIN_ANNOTATION_TYPES,
	adminFieldContract,
} from "@/lib/admin/field-contract";
import { parseBibliographicDate } from "@/lib/bibliographic-date";

const inputClassNames = {
	input: "text-sm",
	inputWrapper: "h-10 min-h-10 rounded-xl",
} as const;

const textareaClassNames = {
	input: "text-sm",
	inputWrapper: "rounded-xl",
} as const;

const selectClassNames = {
	trigger: "h-10 min-h-10 rounded-xl",
	value: "text-sm",
} as const;

type DateMode = "day" | "flexible" | "month" | "year";

const DATE_MODES: Array<{ key: DateMode; label: string }> = [
	{ key: "day", label: "Exact date" },
	{ key: "month", label: "Month" },
	{ key: "year", label: "Year" },
	{ key: "flexible", label: "Flexible text" },
];

function dateMode(value: string): DateMode {
	const parsed = parseBibliographicDate(value);
	if (parsed.kind === "parsed") {
		if (parsed.precision === "day") return "day";
		if (parsed.precision === "month") return "month";
		if (parsed.precision === "year") return "year";
	}
	return value ? "flexible" : "day";
}

function BibliographicDateField({
	disabled,
	error,
	id,
	label,
	onValueChange,
	value,
}: CommonFieldProps) {
	const [mode, setMode] = useState<DateMode>(() => dateMode(value));
	const inputType = mode === "day" ? "date" : mode === "month" ? "month" : "text";
	return (
		<div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
			<select
				aria-label={`${label} precision`}
				className="h-10 rounded-xl border-small border-black/10 bg-white px-3 text-sm text-black/80 outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 dark:border-white/10 dark:bg-secondary dark:text-white/80"
				disabled={disabled}
				value={mode}
				onChange={(event) => {
					const selected = event.currentTarget.value as DateMode;
					if (selected === mode) return;
					setMode(selected);
					onValueChange("");
				}}
			>
				{DATE_MODES.map((option) => (
					<option key={option.key} value={option.key}>
						{option.label}
					</option>
				))}
			</select>
			<Input
				aria-label={label}
				classNames={inputClassNames}
				description={
					mode === "flexible"
						? "For example: Spring 2024 or circa 1998"
						: undefined
				}
				errorMessage={error}
				id={id}
				inputMode={mode === "year" ? "numeric" : undefined}
				isDisabled={disabled}
				isInvalid={Boolean(error)}
				max={mode === "year" ? "2999" : undefined}
				min={mode === "year" ? "1000" : undefined}
				pattern={mode === "year" ? "[12][0-9]{3}" : undefined}
				placeholder={mode === "flexible" ? "Enter date text" : undefined}
				type={inputType}
				value={value}
				onValueChange={onValueChange}
			/>
		</div>
	);
}

type CommonFieldProps = {
	disabled: boolean;
	error?: string;
	id: string;
	label: string;
	onValueChange: (value: string) => void;
	value: string;
};

export function AdminMetadataField({
	descriptor,
	...props
}: CommonFieldProps & { descriptor: ZoteroFieldDescriptor }) {
	const { kind } = adminFieldContract(descriptor);
	if (kind === "bibliographic-date") {
		return (
			<div data-field-kind={kind}>
				<BibliographicDateField {...props} />
			</div>
		);
	}
	if (kind === "multiline") {
		return (
			<Textarea
				aria-label={props.label}
				classNames={textareaClassNames}
				data-field-kind={kind}
				errorMessage={props.error}
				id={props.id}
				isDisabled={props.disabled}
				isInvalid={Boolean(props.error)}
				maxRows={12}
				minRows={descriptor.field === "abstractNote" ? 4 : 2}
				value={props.value}
				onValueChange={props.onValueChange}
			/>
		);
	}
	if (kind === "annotation-type") {
		return (
			<Select
				aria-label={props.label}
				classNames={selectClassNames}
				data-field-kind={kind}
				errorMessage={props.error}
				id={props.id}
				isDisabled={props.disabled}
				isInvalid={Boolean(props.error)}
				selectedKeys={props.value ? [props.value] : []}
				onSelectionChange={(selection) => {
					const selected = selection === "all" ? null : [...selection][0];
					if (typeof selected === "string") props.onValueChange(selected);
				}}
			>
				{ADMIN_ANNOTATION_TYPES.map((type) => (
					<SelectItem key={type}>
						{type[0]!.toUpperCase() + type.slice(1)}
					</SelectItem>
				))}
			</Select>
		);
	}

	const inputType =
		kind === "access-date"
			? "date"
			: kind === "color"
				? "color"
				: kind === "url"
					? "url"
					: "text";
	const inputMode =
		kind === "url"
			? "url"
			: kind === "pmid" || kind === "pmcid"
				? "numeric"
				: undefined;
	return (
		<Input
			aria-label={props.label}
			autoCapitalize={kind === "doi" || kind === "url" ? "none" : undefined}
			classNames={inputClassNames}
			data-field-kind={kind}
			errorMessage={props.error}
			id={props.id}
			inputMode={inputMode}
			isDisabled={props.disabled}
			isInvalid={Boolean(props.error)}
			spellCheck={kind === "doi" || kind === "url" ? false : undefined}
			type={inputType}
			value={props.value}
			onValueChange={props.onValueChange}
		/>
	);
}
