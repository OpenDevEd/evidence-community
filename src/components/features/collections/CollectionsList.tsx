"use client";

import {
	Accordion,
	AccordionItem,
	AutocompleteItem,
	Button,
	Checkbox,
	Dropdown,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	Input,
	tv,
	useDisclosure,
} from "@nextui-org/react";
import { useParamsState } from "@/hooks/useParamsState";
import { Skeleton } from "../../nextui/Skeleton";
import { GrConfigure } from "react-icons/gr";
import { useHierarchy } from "@/hooks/useHierarchy";
import { twMerge } from "tailwind-merge";
import CollectionCategory from "./CollectionCategory";
import { CollectionsGetResponse } from "@/app/api/collections/types";
import { Autocomplete } from "../../nextui/Autocomplete";
import { Switch } from "../../nextui/Switch";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const currentYear = new Date().getFullYear();

const years = Array.from({ length: 300 }).map((_, i) => String(currentYear - i));

function YearPicker({
	label,
	placeholder,
	selectedKey,
	onSelectionChange,
}: {
	label?: string;
	placeholder: string;
	selectedKey: string | null;
	onSelectionChange: (value: any | null) => void;
}) {
	return (
		<Autocomplete
			onClear={() => onSelectionChange(null)}
			className="flex-1"
			placeholder={placeholder}
			label={label}
			key={label}
			fullWidth={true}
			selectedKey={selectedKey}
			onSelectionChange={onSelectionChange}
			inputProps={{
				classNames: {
					inputWrapper:
						"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
					input: "placeholder:text-black/60 dark:placeholder:text-white/40",
				},
			}}
		>
			{years.map((year) => (
				<AutocompleteItem key={year}>
					{year}
				</AutocompleteItem>
			))}
		</Autocomplete>
	);
}

export default function CollectionsList({
	data,
	handleCheckboxChange,
	selectedCollections,
	hierarchy,
	range,
	handleRangeChange,
	isModal = false,
}: {
	data: CollectionsGetResponse | undefined;
	handleCheckboxChange: (key: string) => void;
	selectedCollections: string[];
	isModal?: boolean;
	range: string;
	handleRangeChange: (start: string | null, end: string | null) => void;
} & ReturnType<typeof useHierarchy>) {
	const [start, end, sameYear] = useMemo(() => {
		const dashExists = range.includes("-");
		const [start, end] = range.split("-");
		const startNumber = start || "";
		const endNumber = end || "";
		return [startNumber, endNumber, !dashExists];
	}, [range]);

	return (
		<div
			className={twMerge(
				"w-full xl:w-[456px] shrink-0",
				isModal ? "block" : "hidden xl:block"
			)}
		>
			<Skeleton
				className="w-full xl:min-h-screen rounded-2xl"
				isLoaded={!!data}
			>
				<div className="w-full  bg-black/[4%] dark:bg-secondary rounded-t-2xl flex flex-col gap-4 p-6">
					<div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
						<span>Publication Year</span>
						<div className="flex gap-4 items-center flex-1 justify-end">
							<Switch
								isSelected={!sameYear}
								onValueChange={(value) => handleRangeChange(start, sameYear ? end : null)}
								classNames={{
									label: "text-sm font-normal",
								}}
							>
								Year Range
							</Switch>
						</div>
					</div>
					<div>
						<AnimatePresence mode="popLayout" initial={false}>
							{sameYear ? (
								<motion.div
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 10 }}
									key="same-year"
									layout
									className="w-full"
								>
									<YearPicker
										label="Exact Year"
										placeholder="Year"
										selectedKey={start}
										onSelectionChange={(key) => handleRangeChange(key, null)}
									/>
								</motion.div>
							) : (
								<motion.div
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 10 }}
									key="year-range"
									layout
									className="flex gap-4 w-full"
								>
									{[
										{
											label: "From",
											placeholder: "Year",
										},
										{
											label: "To",
											placeholder: "Year",
										},
									].map(
										({ label, placeholder }, index) => (
											<YearPicker
												key={label}
												label={label}
												placeholder={placeholder}
												selectedKey={index === 0 ? start : end}
												onSelectionChange={(key) => handleRangeChange(
													index === 0 ? (key || "") : start,
													index === 1 ? (key || "") : end
												)}
											/>
										)
									)}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>
				{hierarchy && hierarchy.length > 0 ? (
					<Accordion
						defaultExpandedKeys={hierarchy.map((c) => c.key)}
						selectionMode="multiple"
						fullWidth={false}
						variant="shadow"
						className="bg-white dark:bg-card p-6 rounded-xl rounded-t-none shadow-none"
						itemClasses={{
							title: "text-black/80 dark:text-white/80 font-base text-2xl",
							indicator: "text-black/80 dark:text-white/80",
							trigger: "p-0",
							base: "mb-4 last:mb-0",
							content: "py-0 pt-2",
						}}
						showDivider={false}
					>
						{hierarchy
							.filter(
								(c) => c.numCollections && c.numCollections > 0
							)
							.map((collection) => (
								<AccordionItem
									key={collection.key}
									title={collection.title || collection.name}
								>
									<CollectionCategory
										collection={collection}
										hierarchy={hierarchy}
										selectedCollections={
											selectedCollections
										}
										handleCheckboxChange={
											handleCheckboxChange
										}
									/>
								</AccordionItem>
							))}
					</Accordion>
				) : (
					<div className="text-lg bg-white dark:bg-card p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 xl:h-screen select-none">
						<GrConfigure className="stroke-current size-6" />
						<span>No facets configured.</span>
					</div>
				)}
			</Skeleton>
		</div>
	);
}
