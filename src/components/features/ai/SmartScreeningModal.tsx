"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import {
	ModalBody,
	ModalContent,
	ScrollShadow,
	Textarea,
} from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useLocalStorage } from "usehooks-ts";

import { toast } from "@/components/layout/Toast";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import {
	parseScreeningFieldLines,
	screeningFieldErrors,
	screeningFieldsAsText,
} from "@/lib/ai/screening-fields";
import {
	SMART_SCREENING_FIELD_TYPES,
	type SmartScreeningField,
} from "@/types/ai";
import AIHeader from "./AIHeader";

type ScreeningTab = "fields" | "text";

const FIELD_BOX_CLASSES = {
	inputWrapper:
		"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
	input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
};

/** One screening question: its label, what it asks for, and its answer type. */
function ScreeningFieldRow({
	error,
	field,
	onChange,
	onRemove,
}: {
	error?: string;
	field: SmartScreeningField;
	onChange: (changes: Partial<SmartScreeningField>) => void;
	onRemove: () => void;
}) {
	const t = useTranslations("ui");
	const errorFor = (isEmpty: boolean) => (isEmpty ? error : undefined);

	return (
		<motion.div
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.3 }}
			className="flex flex-col gap-2"
		>
			<Input
				isRequired
				placeholder={t("label")}
				label={t("label")}
				value={field.label}
				isInvalid={Boolean(errorFor(!field.label))}
				errorMessage={errorFor(!field.label)}
				onChange={(e) => onChange({ label: e.target.value })}
			/>
			<Textarea
				isRequired
				placeholder={t("description")}
				label={t("description")}
				value={field.description}
				isInvalid={Boolean(errorFor(!field.description))}
				errorMessage={errorFor(!field.description)}
				onChange={(e) => onChange({ description: e.target.value })}
				classNames={FIELD_BOX_CLASSES}
			/>
			<div className="flex justify-between">
				<Select
					color="tertiary"
					label={t("typeLabel")}
					placement="left"
					disallowEmptySelection
					selectedKeys={field.type ? [field.type] : undefined}
					isInvalid={Boolean(errorFor(!field.type))}
					errorMessage={errorFor(!field.type)}
					onSelectionChange={(value) => {
						onChange({
							type: Array.from(
								value,
							)[0] as (typeof SMART_SCREENING_FIELD_TYPES)[number],
						});
					}}
				>
					{SMART_SCREENING_FIELD_TYPES.map((type) => (
						<SelectItem key={type} value={type}>
							{type}
						</SelectItem>
					))}
				</Select>
				<Button
					isIconOnly
					color="danger"
					onPress={onRemove}
					className="!p-0"
				>
					<HugeiconsIcon icon={Delete02Icon} className="size-4" />
				</Button>
			</div>
		</motion.div>
	);
}

/** The list of screening questions, one row each. */
function ScreeningFieldsForm({
	fieldErrors,
	localFields,
	onSubmit,
	setLocalFields,
}: {
	fieldErrors: Record<number, string>;
	localFields: SmartScreeningField[];
	onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
	setLocalFields: (fields: SmartScreeningField[]) => void;
}) {
	const t = useTranslations("ui");

	return (
		<form id="fields-form" onSubmit={onSubmit} className="flex flex-col gap-6">
			<AnimatePresence mode="sync">
				<div className="p-6 flex flex-col gap-6">
					{localFields.length === 0 ? (
						<p className="text-center text-black/60 dark:text-white/40 my-12 mt-14">
							{t("noFieldsAdded")}
						</p>
					) : null}
					{localFields.map((field, index) => (
						// Rows have no stable identity of their own, so their
						// position in the list is the key.
						<ScreeningFieldRow
							key={index}
							error={fieldErrors[index]}
							field={field}
							onChange={(changes) => {
								setLocalFields(
									localFields.map((f, i) =>
										i === index ? { ...f, ...changes } : f,
									),
								);
							}}
							onRemove={() => {
								setLocalFields(
									localFields.filter((_, i) => i !== index),
								);
							}}
						/>
					))}
				</div>
			</AnimatePresence>
		</form>
	);
}

/** The same questions as plain text, one per line. */
function ScreeningTextForm({
	convertedText,
	onSubmit,
	placeholderExample,
}: {
	convertedText: string;
	onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
	placeholderExample: string;
}) {
	const t = useTranslations("ui");

	return (
		<form
			id="text-form"
			onSubmit={onSubmit}
			className="flex flex-col gap-6 p-6"
		>
			<Textarea
				name="text"
				defaultValue={convertedText}
				classNames={FIELD_BOX_CLASSES}
				placeholder={placeholderExample}
				label={t("textLabel")}
			/>
		</form>
	);
}

/** Switches between the list of questions and the plain-text version. */
function ScreeningTabs({
	labels,
	onTabChange,
	tab,
	tabs,
}: {
	labels: readonly string[];
	onTabChange: (tab: ScreeningTab) => void;
	tab: ScreeningTab;
	tabs: readonly ScreeningTab[];
}) {
	return (
		<div className="flex gap-0 px-6 py-2">
			{tabs.map((name, index) => (
				<Button
					key={name}
					size="md"
					color={tab === name ? "accent" : "secondary"}
					className={twMerge(
						"rounded-none",
						name === tabs[0] && "rounded-l-2xl",
						name === tabs.at(-1) && "rounded-r-2xl",
					)}
					onPress={() => onTabChange(name)}
				>
					{labels[index]}
				</Button>
			))}
		</div>
	);
}

/** The save button, plus "add a question" on the list tab. */
function ScreeningFooter({
	onAddField,
	tab,
}: {
	onAddField: () => void;
	tab: ScreeningTab;
}) {
	const t = useTranslations("ui");

	if (tab === "text") {
		return (
			<div className="flex justify-end gap-4 z-10 p-2 rounded-b-2xl">
				<Button type="submit" form="text-form">
					{t("save")}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex justify-end gap-4 z-10 p-2 rounded-b-2xl">
			<Button size="md" onPress={onAddField}>
				{t("addField")}
			</Button>
			<Button type="submit" form="fields-form" color="accent" size="md">
				{t("saveFields")}
			</Button>
		</div>
	);
}

export function SmartScreeningModal({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("ui");
	const tabs = ["fields", "text"] as const satisfies readonly ScreeningTab[];
	const labels = [t("fields"), t("textLabel")] as const;
	const [tab, setTab] = useState<ScreeningTab>("fields");
	const [fields, setFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[],
	);
	const [localFields, setLocalFields] = useState<SmartScreeningField[]>(
		() => [...fields],
	);
	const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
	const placeholderExample = `${t("label")} (${SMART_SCREENING_FIELD_TYPES.join(
		" | ",
	)}): ${t("description")}`;

	const convertedText = screeningFieldsAsText(fields);

	const validatorFunction = (candidates: SmartScreeningField[]) => {
		const newErrors = screeningFieldErrors(candidates, t);
		setFieldErrors(newErrors);

		if (Object.keys(newErrors).length > 0) {
			toast({
				title: t("fixFieldErrors"),
				description: Object.values(newErrors).join("\n"),
			});

			return;
		}

		setFields(candidates);
		toast({
			title: t("fieldsSavedSuccess"),
			description: t("fieldsSavedSuccess"),
		});
	};

	const handleFieldsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		validatorFunction(localFields);
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.target as HTMLFormElement);
		validatorFunction(
			parseScreeningFieldLines(formData.get("text")?.toString() ?? ""),
		);
	};

	return (
		<DialogModal
			size="xl"
			scrollBehavior="inside"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent>
				{(onClose) => (
					<>
						<AIHeader onClose={onClose}>
							{t("smartScreening")}
						</AIHeader>
						<ScreeningTabs
							labels={labels}
							onTabChange={setTab}
							tab={tab}
							tabs={tabs}
						/>
						<ModalBody className="p-0 relative">
							<ScrollShadow className="h-full">
								{tab === "fields" ? (
									<ScreeningFieldsForm
										fieldErrors={fieldErrors}
										localFields={localFields}
										onSubmit={handleFieldsSubmit}
										setLocalFields={setLocalFields}
									/>
								) : (
									<ScreeningTextForm
										convertedText={convertedText}
										onSubmit={handleSubmit}
										placeholderExample={placeholderExample}
									/>
								)}
							</ScrollShadow>
						</ModalBody>
						<ScreeningFooter
							onAddField={() => {
								setLocalFields([
									...localFields,
									{
										label: "",
										type: "string",
										description: "",
									},
								]);
							}}
							tab={tab}
						/>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}
