"use client";

import type { ZoteroFieldDescriptor } from "@opendeved/evidence-library-core/zotero-schema";
import { memo, useState } from "react";

import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Textarea } from "@/components/nextui/Textarea";
import {
	ADMIN_ANNOTATION_TYPES,
	adminFieldContract,
} from "@/lib/admin/field-contract";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { filledFieldSurface } from "@/components/nextui/field-styles";
import { InstitutionInput } from "./InstitutionInput";

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

type DateMode = "day" | "month" | "year";

const DATE_MODES: Array<{ key: DateMode; label: string }> = [
	{ key: "day", label: "Exact date" },
	{ key: "month", label: "Month" },
	{ key: "year", label: "Year" },
];

const DATE_INPUT_TYPES: Record<DateMode, string> = {
	day: "date",
	month: "month",
	year: "number",
};

function dateMode(value: string): DateMode {
	const parsed = parseBibliographicDate(value);
	return parsed.kind === "parsed" ? parsed.precision : "day";
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
	const parsedValue = parseBibliographicDate(value);
	const displayedMode =
		parsedValue.kind === "parsed" ? parsedValue.precision : mode;
	const inputType = DATE_INPUT_TYPES[displayedMode];
	return (
		<div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
			<select
				aria-label={`${label} precision`}
				className={`h-10 rounded-xl px-3 text-sm text-black/80 outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 dark:text-white/80 ${filledFieldSurface}`}
				disabled={disabled}
				value={displayedMode}
				onChange={(event) => {
					const selected = event.currentTarget.value as DateMode;
					if (selected === displayedMode) return;
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
				color="filled"
				aria-label={label}
				classNames={inputClassNames}
				errorMessage={error}
				id={id}
				inputMode={displayedMode === "year" ? "numeric" : undefined}
				isDisabled={disabled}
				isInvalid={Boolean(error)}
				max={displayedMode === "year" ? "2999" : undefined}
				min={displayedMode === "year" ? "1000" : undefined}
				pattern={displayedMode === "year" ? "[12][0-9]{3}" : undefined}
				step={displayedMode === "year" ? 1 : undefined}
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

export const AdminMetadataField = memo(function AdminMetadataField({
	descriptor,
	onFieldChange,
	...fieldProps
}: Omit<CommonFieldProps, "onValueChange"> & { descriptor: ZoteroFieldDescriptor; onFieldChange: (field: string, value: string) => void }) {
	const props = { ...fieldProps, onValueChange: (value: string) => onFieldChange(descriptor.field, value) };
	const { kind } = adminFieldContract(descriptor);
	if (kind === "institution-list") return <InstitutionInput {...props} />;
	if (kind === "bibliographic-date") {
		return (
			<div data-field-kind={kind}>
				<BibliographicDateField {...props} />
			</div>
		);
	}
	if (kind === "access-date") {
		return (
			<Input
				color="filled"
				aria-label={props.label}
				classNames={inputClassNames}
				data-field-kind={kind}
				errorMessage={props.error}
				id={props.id}
				isDisabled={props.disabled}
				isInvalid={Boolean(props.error)}
				type="date"
				value={props.value}
				onValueChange={props.onValueChange}
			/>
		);
	}
	if (kind === "multiline") {
		return (
			<Textarea
				color="filled"
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
	if (kind === "annotation-type") return <AnnotationTypeField {...props} />;
	if (kind === "color") {
		const pickerValue = /^#[\da-f]{6}$/iu.test(props.value)
			? props.value
			: "#ffd400";
		return (
			<Input
				color="filled"
				aria-label={props.label}
				classNames={inputClassNames}
				data-field-kind={kind}
				endContent={
					<input
						aria-label={`${props.label} picker`}
						disabled={props.disabled}
						type="color"
						value={pickerValue}
						onChange={(event) =>
							props.onValueChange(event.currentTarget.value)
						}
					/>
				}
				errorMessage={props.error}
				id={props.id}
				isDisabled={props.disabled}
				isInvalid={Boolean(props.error)}
				placeholder="#ffd400"
				type="text"
				value={props.value}
				onValueChange={props.onValueChange}
			/>
		);
	}

	const inputType = kind === "url" ? "url" : "text";
	const inputMode = kind === "url" ? "url" : undefined;
	return (
		<Input
			color="filled"
			aria-label={props.label}
			autoCapitalize={kind === "url" ? "none" : undefined}
			classNames={inputClassNames}
			data-field-kind={kind}
			errorMessage={props.error}
			id={props.id}
			inputMode={inputMode}
			isDisabled={props.disabled}
			isInvalid={Boolean(props.error)}
			spellCheck={kind === "url" ? false : undefined}
			type={inputType}
			value={props.value}
			onValueChange={props.onValueChange}
		/>
	);
});

function AnnotationTypeField(props: CommonFieldProps) {
	const kind = "annotation-type";
	return (
		<Select
			color="filled"
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
