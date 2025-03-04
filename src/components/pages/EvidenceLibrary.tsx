"use client";
import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import {
	IoChatboxOutline,
	IoChatbubblesOutline,
	IoGrid,
	IoSearch,
	IoSend,
} from "react-icons/io5";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import {
	Divider,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ScrollShadow,
	Spinner,
	Textarea,
	Tooltip,
	useDisclosure,
} from "@nextui-org/react";
import React, { ReactNode, use, useRef, useState, useEffect } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { AiOutlineCompass } from "react-icons/ai";
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS, SCOPE_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useTranslations } from "next-intl";
import {
	GiArchiveResearch,
	GiConsoleController,
	GiStarSwirl,
} from "react-icons/gi";
import { FaSort } from "react-icons/fa";
import { HiOutlineViewList } from "react-icons/hi";
import { BiHelpCircle, BiTrash } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal from "../features/modals/ChatModal";
import ModelSelector from "../features/ai/ModelSelector";
import { useFeatureFlagEnabled } from "@/context/Providers";
import DialogModal from "../nextui/DialogModal";
import AIHeader from "../features/ai/AIHeader";
import { useLocalStorage } from "usehooks-ts";
import { AnimatePresence, motion } from "framer-motion";
import { useModalError } from "@/hooks/useModalError";
import { z } from "zod";
import { toast } from "@/components/layout/Toast";

function DropDownIcon({
	Icon,
	className,
	label,
}: {
	Icon: any;
	className?: string;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<Icon
				className={twMerge("w-full h-full", className)}
				aria-label={label}
			/>
		</div>
	);
}

const genericSelectClassNames = {
	base: "!mt-0",
	mainWrapper: "h-10 xl:h-full",
	label: "hidden",
};

export function ContentInteractions({
	abstract,
	onAbstractChange,
	view,
	setView,
	countLabel,
	extraFilters,
	header,
}: {
	abstract: boolean;
	onAbstractChange: (abstract: boolean) => void;
	view: string;
	setView: (view: string) => void;
	countLabel: ReactNode;
	extraFilters: ReactNode;
	header?: ReactNode;
}) {
	const itemsContext = use(ItemsContext);
	const {
		isOpen: isExploreOpen,
		onOpen: onExploreOpen,
		onOpenChange: onExploreOpenChange,
	} = useDisclosure();
	const {
		isOpen: isHelpOpen,
		onOpen: onHelpOpen,
		onOpenChange: onHelpOpenChange,
	} = useDisclosure();
	const [debouncedSearch, _] = useDebounce(
		itemsContext.handleSearchChange,
		0
	);
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;
	const t = useTranslations("ui");
	const tSorts = useTranslations("sorts");
	const tScopes = useTranslations("scopes");
	const formatter = useFormatter();

	function SortComponent() {
		return (
			<Select
				startContent={<DropDownIcon label="Sort icon" Icon={FaSort} />}
				selectedKeys={
					itemsContext.queryParams.sort && [
						itemsContext.queryParams.sort,
					]
				}
				onSelectionChange={itemsContext.handleSortChange as any}
				items={SORT_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					!itemsContext.userData
						? {
								base: twMerge(
									"flex-1 max-w-full xl:max-w-56 shrink-0",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"h-full",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
						: {
								base: twMerge(
									"flex-1 max-w-full min-w-0 xl:min-w-56",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
				}
				label={"Sort by"}
				labelPlacement="outside"
			>
				{(item: any) => {
					return (
						<SelectItem
							aria-label={tSorts(item.key)}
							key={item.key}
						>
							{tSorts(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}

	function ScopeComponent() {
		return (
			<Select
				startContent={
					<DropDownIcon label="Scope icon" Icon={GiArchiveResearch} />
				}
				color="tertiary"
				selectedKeys={
					itemsContext.queryParams.scope && [
						itemsContext.queryParams.scope,
					]
				}
				onSelectionChange={itemsContext.handleScopeChange as any}
				items={SCOPE_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					!itemsContext.userData
						? {
								base: twMerge(
									"xl:max-w-72 w-full max-w-full",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"h-10 xl:h-full",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
						: {
								base: twMerge(
									"flex-1 max-w-full min-w-0 xl:min-w-56",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
				}
				label={"Search scope"}
				labelPlacement="outside"
			>
				{(item: any) => {
					return (
						<SelectItem
							aria-label={tScopes(item.key)}
							key={item.key}
						>
							{tScopes(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}

	return (
		<>
			{(!itemsContext.userData || header) && (
				<div className="flex w-full flex-col xl:flex-row xl:justify-between xl:items-end h-24 xl:h-12 gap-4 relative">
					<h1 className="text-black dark:text-white/60 font-medium text-2xl xl:text-3xl w-full xl:w-auto h-10 xl:h-12 flex justify-between items-end">
						{header || (
							<>
								<a
									href="#collections"
									className="p-3 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100 bg-background_light dark:bg-background"
								>
									{t("goToFilters")}
								</a>
								{t("searchTitle")}
							</>
						)}
						<Button
							startContent={
								<AiOutlineCompass className="size-6" />
							}
							className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto h-full"
							onPress={onExploreOpen}
						>
							{t("explore")}
						</Button>
						<FullScreenModal
							scrollBehavior="outside"
							isOpen={isExploreOpen}
							onOpenChange={onExploreOpenChange}
						>
							<ModalContent>
								{(onClose: any) => (
									<>
										<GenericHeader onClose={onClose}>
											{t("explore")}
										</GenericHeader>
										{!itemsContext.userData && (
											<CollectionsList
												data={
													itemsContext.collectionsData
												}
												handleCheckboxChange={
													itemsContext.handleCheckboxChange
												}
												selectedCollections={
													itemsContext.selectedCollections
												}
												hierarchy={
													itemsContext.hierarchy!
												}
												isModal
												range={
													itemsContext.queryParams
														.range
												}
												handleRangeChange={
													itemsContext.handleRangeChange
												}
												facetDistribution={
													itemsContext.itemsData
														?.facetDistribution
												}
												queryParams={
													itemsContext.queryParams
												}
												handleInstitutionSelect={
													itemsContext.handleInstitutionSelect
												}
											/>
										)}
									</>
								)}
							</ModalContent>
						</FullScreenModal>
					</h1>
					<div className="flex gap-4 h-10 xl:h-12 flex-1 justify-end">
						{!itemsContext.userData && (
							<>
								<Button
									className="h-full font-medium text-base !p-0"
									isIconOnly
									onPress={onHelpOpen}
									aria-label={t("helpAriaLabel")}
								>
									<BiHelpCircle
										aria-label={t("helpIconAriaLabel")}
										className="size-6"
									/>
								</Button>
								<HelpModal
									isOpen={isHelpOpen}
									onOpenChange={onHelpOpenChange}
								/>
								{<SortComponent />}
							</>
						)}
					</div>
				</div>
			)}
			<section
				role="search"
				className={twMerge(
					"xl:flex xl:flex-row gap-4",
					!itemsContext.userData
						? "flex flex-col"
						: "grid grid-cols-2"
				)}
			>
				<Input
					autoCorrect="off"
					defaultValue={itemsContext.queryParams.search}
					onChange={(e) => debouncedSearch(e.target.value)}
					onClear={() => debouncedSearch("")}
					placeholder={t("search")}
					size={"lg"}
					classNames={{
						inputWrapper: "h-10 xl:h-12 min-h-10 xl:min-h-12",
						base: "col-span-2",
					}}
					isClearable
					startContent={
						<IoSearch
							aria-label={t("searchIconAriaLabel")}
							className="size-6 fill-current text-black/60 dark:text-white/40"
						/>
					}
				/>
				{<ScopeComponent />}
				{itemsContext.userData && <SortComponent />}
				{extraFilters}
			</section>
			<section className="flex justify-between h-10 xl:h-12 gap-4">
				<Skeleton
					isLoaded={!!itemsContext.itemsData}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center whitespace-pre"
					>
						{countLabel ||
							t.rich("resourcesCount", {
								count: formatter.number(
									actuallyNoData
										? 0
										: itemsContext.itemsData?.totalItems ||
												0
								),
								number: (chunks) => (
									<span
										suppressHydrationWarning
										className="text-2xl leading-6"
									>
										{chunks}{" "}
									</span>
								),
							})}
						{itemsContext.isItemsFetching && (
							<div className="relative ltr:ml-3 rtl:mr-3 flex items-center">
								<Spinner
									size="sm"
									className="opacity-60 absolute"
								/>
							</div>
						)}
					</h2>
				</Skeleton>
				<section className="xl:min-w-72 flex gap-4">
					<Card className="h-full flex items-center justify-center flex-1 min-w-0 px-0">
						<div className="px-3">
							<Switch
								size="sm"
								isSelected={abstract}
								onValueChange={onAbstractChange}
								classNames={{
									base: "flex-row-reverse",
								}}
							>
								{t("abstract")}
							</Switch>
						</div>
					</Card>
					<div className="hidden xl:flex gap-0 w-28">
						<Button
							color={view === "list" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-r-none flex-1"
							onPress={() => setView("list")}
							aria-label={t("viewAsListAriaLabel")}
						>
							<HiOutlineViewList
								aria-label={t("viewAsListAriaLabel")}
								className="size-6"
							/>
						</Button>
						<Button
							color={view === "grid" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-l-none flex-1"
							onPress={() => setView("grid")}
							aria-label={t("viewAsGridAriaLabel")}
						>
							<IoGrid
								aria-label={t("viewAsGridAriaLabel")}
								className="size-4"
							/>
						</Button>
					</div>
				</section>
			</section>
		</>
	);
}

function MainContent() {
	const props = useItemsList();

	return (
		<>
			<CollectionsList
				data={props.collectionsData}
				handleCheckboxChange={props.handleCheckboxChange}
				selectedCollections={props.selectedCollections}
				hierarchy={props.hierarchy}
				range={props.queryParams.range}
				handleRangeChange={props.handleRangeChange}
				facetDistribution={props.itemsData?.facetDistribution}
				queryParams={props.queryParams}
				handleInstitutionSelect={props.handleInstitutionSelect}
			/>
			<ItemsList props={props} />
		</>
	);
}

const smartScreeningFieldTypes = ["string", "number", "boolean"] as const;


export type SmartScreeningField = {
	label: string;
	description: string;
	type: (typeof smartScreeningFieldTypes)[number];
};


function SmartScreeningModal({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("ui");
	const tabs = ["fields", "text"] as const;
	const labels = [t("fields"), t("textLabel")] as const;
	const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
	const [fields, setFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[]
	);
	const [localFields, setLocalFields] = useState<SmartScreeningField[]>([]);
	const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
	const placeholderExample = `${t("label")} (${smartScreeningFieldTypes.join(
		" | "
	)}): ${t("description")}`;	

	useEffect(() => {
		if (isOpen) {
			setLocalFields([...fields]);
			setFieldErrors({});
		}
	}, [isOpen, fields]);

	const fieldSchema = z.object({
		label: z
			.string()
			.min(1, t("labelRequired"))
			.max(64, t("labelTooLong")),
		type: z.enum(["string", "number", "boolean"]),
		description: z
			.string()
			.min(1, t("descriptionRequired"))
			.max(1024, t("descriptionTooLong")),
	});

	const convertedText = fields
		.map(
			(field) =>
				`${field.label.trim()} (${
					field.type
				}): ${field.description.trim()}`
		)
		.join("\n");

	const validatorFunction = (localFields: SmartScreeningField[]) => {
		const newErrors: Record<number, string> = {};
		let hasErrors = false;

		// Check for duplicate labels
		const labelCounts: Record<string, number[]> = {};
		localFields.forEach((field, index) => {
			const label = field.label.trim();
			if (label) {
				if (!labelCounts[label]) {
					labelCounts[label] = [];
				}
				labelCounts[label].push(index);
			}
		});

		// Mark duplicate labels as errors
		Object.entries(labelCounts).forEach(([label, indices]) => {
			if (indices.length > 1) {
				indices.forEach((index) => {
					newErrors[index] = `${t("fieldPrefix")} ${
						index + 1
					} ${label}: ${t("duplicateLabelError")}`;
					hasErrors = true;
				});
			}
		});

		// Validate each field with Zod schema
		localFields.forEach((field, index) => {
			if (!newErrors[index]) {
				// Only validate if not already marked as duplicate
				try {
					fieldSchema.parse(field);
				} catch (error) {
					if (error instanceof z.ZodError) {
						const fieldError =
							error.errors[0]?.message || t("invalidField");
						newErrors[index] = `${t("fieldPrefix")} ${
							index + 1
						} ${field.label}: ${fieldError}`;
						hasErrors = true;
					}
				}
			}
		});

		setFieldErrors(newErrors);

		if (!hasErrors) {
			setFields(localFields);
			toast({
				title: t("fieldsSavedSuccess"),
				description: t("fieldsSavedSuccess"),
			});
		} else {
			toast({
				title: "Please fix the errors in the fields",
				description: Object.values(newErrors).join("\n"),
			});
		}
	};

	const handleFieldsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		validatorFunction(localFields);
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.target as HTMLFormElement);
		const text = formData.get("text");
		const localFields: SmartScreeningField[] = [];
		const lines = text?.toString().split("\n");
		if (lines) {
			lines.forEach((line) => {
				const [key, ...rest] = line.split(":");
				const [label, typeWithParentheses] = key?.split("(") || [];
				const [type, parentheses] =
					typeWithParentheses?.split(")") || [];
				const description = rest.join(":").trim();
				if (line.length > 0) {
					localFields.push({
						label: label?.trim(),
						type: type?.trim() as (typeof smartScreeningFieldTypes)[number],
						description: description?.trim(),
					});
				}
			});
		}
		validatorFunction(localFields);
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
						<AIHeader onClose={onClose}>{t("smartScreening")}</AIHeader>
						<div className="flex gap-0 px-6  py-2">
							{tabs.map((t, i) => (
								<Button
									key={t}
									size="md"
									color={tab === t ? "accent" : "secondary"}
									className={twMerge(
										"rounded-none",
										t === tabs[0] && "rounded-l-2xl",
										t === tabs.at(-1) && "rounded-r-2xl"
									)}
									onPress={() => setTab(t)}
								>
									{labels[i]}
								</Button>
							))}
						</div>
						<ModalBody className="p-0 relative">
							<ScrollShadow className="h-full">
								{tab === "fields" ? (
									<form
										id="fields-form"
										key="fields"
										onSubmit={handleFieldsSubmit}
										className="flex flex-col gap-6"
									>
										<AnimatePresence mode="sync">
											<div
												key="fields"
												className="p-6 flex flex-col gap-6"
											>
												{localFields.length === 0 && (
													<p
														key="empty"
														className="text-center text-black/60 dark:text-white/40 my-12 mt-14"
													>
														{t("noFieldsAdded")}
													</p>
												)}
												{localFields.map(
													(field, index) => (
														<motion.div
															key={index}
															initial={{
																opacity: 0,
																y: 10,
															}}
															animate={{
																opacity: 1,
																y: 0,
															}}
															transition={{
																duration: 0.3,
															}}
															className="flex flex-col gap-2"
														>
															<Input
																isRequired
																placeholder={t("label")}
																label={t("label")}
																value={
																	field.label
																}
																isInvalid={
																	!!fieldErrors[
																		index
																	] &&
																	!field.label
																}
																errorMessage={
																	fieldErrors[
																		index
																	] &&
																	!field.label
																		? fieldErrors[
																				index
																		  ]
																		: undefined
																}
																onChange={(e) =>
																	setLocalFields(
																		localFields.map(
																			(
																				f,
																				i
																			) =>
																				i ===
																				index
																					? {
																							...f,
																							label: e
																								.target
																								.value,
																					  }
																					: f
																		)
																	)
																}
															/>
															<Textarea
																placeholder={t("description")}
																label={t("description")}
																value={
																	field.description
																}
																isRequired={
																	true
																}
																isInvalid={
																	!!fieldErrors[
																		index
																	] &&
																	!field.description
																}
																errorMessage={
																	fieldErrors[
																		index
																	] &&
																	!field.description
																		? fieldErrors[
																				index
																		  ]
																		: undefined
																}
																onChange={(e) =>
																	setLocalFields(
																		localFields.map(
																			(
																				f,
																				i
																			) =>
																				i ===
																				index
																					? {
																							...f,
																							description:
																								e
																									.target
																									.value,
																					  }
																					: f
																		)
																	)
																}
																classNames={{
																	inputWrapper:
																		"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
																	input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base xl:text-small",
																}}
															/>
															<div className="flex justify-between">
																<Select
																	color="tertiary"
																	label={t("typeLabel")}
																	placement="left"
																	disallowEmptySelection={
																		true
																	}
																	selectedKeys={
																		field.type
																			? [
																					field.type,
																			  ]
																			: undefined
																	}
																	isInvalid={
																		!!fieldErrors[
																			index
																		] &&
																		!field.type
																	}
																	errorMessage={
																		fieldErrors[
																			index
																		] &&
																		!field.type
																			? fieldErrors[
																					index
																			  ]
																			: undefined
																	}
																	onSelectionChange={(
																		value
																	) => {
																		const selectedType =
																			Array.from(
																				value
																			)[0] as (typeof smartScreeningFieldTypes)[number];
																		setLocalFields(
																			localFields.map(
																				(
																					f,
																					i
																				) =>
																					i ===
																					index
																						? {
																								...f,
																								type: selectedType,
																						  }
																						: f
																			)
																		);
																	}}
																>
																	{smartScreeningFieldTypes.map(
																		(
																			type
																		) => (
																			<SelectItem
																				key={
																					type
																				}
																				value={
																					type
																				}
																			>
																				{
																					type
																				}
																			</SelectItem>
																		)
																	)}
																</Select>
																<Button
																	isIconOnly
																	color="danger"
																	onPress={() =>
																		setLocalFields(
																			localFields.filter(
																				(
																					_,
																					i
																				) =>
																					i !==
																					index
																			)
																		)
																	}
																	className="!p-0"
																>
																	<BiTrash className="size-4" />
																</Button>
															</div>
														</motion.div>
													)
												)}
											</div>
										</AnimatePresence>
									</form>
								) : (
									<form
										id="text-form"
										key="text"
										onSubmit={handleSubmit}
										className="flex flex-col gap-6 p-6"
									>
										<AnimatePresence mode="sync">
											<Textarea
												name="text"
												defaultValue={convertedText}
												classNames={{
													inputWrapper:
														"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
													input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base xl:text-small",
												}}
												placeholder={placeholderExample}
												label={t("textLabel")}
											/>
										</AnimatePresence>
									</form>
								)}
							</ScrollShadow>
						</ModalBody>
						<div
							key="fields-footer"
							className="flex justify-end gap-4 z-10 p-2 rounded-b-2xl"
						>
							{tab === "fields" ? (
								<>
									<Button
										size="md"
										onPress={() =>
											setLocalFields([
												...localFields,
												{
													label: "",
													type: "string",
													description: "",
												},
											])
										}
									>
										{t("addField")}
									</Button>
									<Button
										type="submit"
										form="fields-form"
										color="accent"
										size="md"
									>
										{t("saveFields")}
									</Button>
								</>
							) : (
								<Button type="submit" form="text-form">
									{t("save")}
								</Button>
							)}
						</div>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}

function AIChat() {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const {
		modelObject: { icon: Icon },
		selectedModel,
		setSelectedModel,
	} = useSelectedModel();
	const {
		isOpen: isChatOpen,
		onOpen: onChatOpen,
		onOpenChange: onChatOpenChange,
	} = useDisclosure();
	const {
		isOpen: isModelOpen,
		onOpen: onModelOpen,
		onOpenChange: onModelOpenChange,
	} = useDisclosure();
	const {
		isOpen: isSmartScreeningOpen,
		onOpen: onSmartScreeningOpen,
		onOpenChange: onSmartScreeningOpenChange,
	} = useDisclosure();
	const [externalInput, setExternalInput] = useState<string>("");

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onChatOpen();
	};

	return (
		<>
			<ModelSelector
				isOpen={isModelOpen}
				onOpenChange={onModelOpenChange}
				selectedModel={selectedModel}
				onModelChange={setSelectedModel}
			/>
			<ChatModal
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				modelIndex={selectedModel}
				externalInput={externalInput}
				setExternalInput={setExternalInput}
			/>
			<SmartScreeningModal
				isOpen={isSmartScreeningOpen}
				onOpenChange={onSmartScreeningOpenChange}
			/>
			<form
				onSubmit={handleSubmit}
				className="fixed bottom-0 left-1/2 -translate-x-1/2 flex justify-center p-4 items-center z-50 group fill-white"
			>
				<div className="flex gap-4">
					<Tooltip content={tUI("openChatTooltip")}>
						<Button
							isIconOnly
							startContent={<IoChatboxOutline />}
							size="md"
							className="!p-0"
							onPress={onChatOpen}
						></Button>
					</Tooltip>
					<div className="relative">
						<Input
							autoComplete="off"
							value={externalInput}
							onValueChange={setExternalInput}
							startContent={
								<Button
									isIconOnly
									variant="invisible"
									className="shrink-0"
									onPress={onModelOpen}
								>
									<Icon className="size-6 bg-accent rounded-full p-1 aspect-square shrink-0" />
								</Button>
							}
							endContent={
								<Button
									type="submit"
									isIconOnly
									variant="invisible"
									className="shrink-0 !p-1"
									onPress={onChatOpen}
								>
									<IoSend className="size-4" />
								</Button>
							}
							placeholder={t("askAI")}
							className="w-auto"
							classNames={{
								inputWrapper:
									"p-2 xl:p-2 backdrop-blur-xl shadow-accent-glow data-[hover]:scale-105 w-64 data-[focus]:w-[28rem] !max-w-[calc(100vw-2rem)] !transition-all !duration-500 ease-bounce-custom",
							}}
						/>
						<div className="size-96 bg-accent/50 opacity-0 group-hover:opacity-75 rounded-full left-1/2 -translate-x-1/2 blur-3xl absolute -z-10 transition-all duration-1000 ease-spring"></div>
					</div>
					<Tooltip content={tUI("smartScreening")}>
						<Button
							isIconOnly
							startContent={<GiStarSwirl />}
							size="md"
							className="!p-0"
							onPress={onSmartScreeningOpen}
						></Button>
					</Tooltip>
				</div>
			</form>
		</>
	);
}

export default function EvidenceLibrary() {
	const isAISearchEnabled = useFeatureFlagEnabled("ai-search");
	return (
		<PageContainer>
			<div className="flex gap-[40px] flex-col xl:flex-row">
				<MainContent />
			</div>
			{isAISearchEnabled && <AIChat />}
		</PageContainer>
	);
}
