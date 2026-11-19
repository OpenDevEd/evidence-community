"use client";
import { Button } from "@/components/nextui/Button";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import CollectionsList from "@/components/features/collections/CollectionsList";
import ExploreModal from "@/components/features/collections/ExploreModal";
import { IoGrid, IoSearch } from "react-icons/io5";
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
	PropsOf,
	ScrollShadow,
	Spinner,
	Textarea,
	Tooltip,
	useDisclosure,
} from "@nextui-org/react";
import React, { useEffect, ReactNode, use, useRef, useState } from "react";
import { Tabs, Tab } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { AiOutlineCompass } from "react-icons/ai";
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS, SCOPE_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useTranslations } from "next-intl";
import { GiArchiveResearch } from "react-icons/gi";
import { LuEye } from "react-icons/lu";
import { FaSort } from "react-icons/fa";
import { HiOutlineViewList } from "react-icons/hi";
import { BiHelpCircle, BiTrash } from "react-icons/bi";
import { MeaningResultNote } from "@/components/features/search/MeaningSearch";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { SearchBar } from "@/components/features/SearchBar";
import { useModEnterHint } from "@/hooks/useShortcutHints";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal from "../features/modals/ChatModal";
import { useFeatureFlagEnabled } from "@/context/Providers";
import DialogModal from "../nextui/DialogModal";
import AIHeader from "../features/ai/AIHeader";
import { useLocalStorage } from "usehooks-ts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useModalError } from "@/hooks/useModalError";
import { z } from "zod";
import { Props } from "next/script";
import { toast } from "@/components/layout/Toast";
import { Formatter } from "recharts/types/component/DefaultTooltipContent";
import { BsStars } from "react-icons/bs";
import useBreakpoint, { useBreakpointBelow } from "@/hooks/useBreakpoint";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { SMART_SCREENING_LIMITS } from "@/lib/ai/schemas";

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
	mainWrapper: "h-10 lg:h-full",
	label: "hidden",
};

// SearchBar now lives in "@/components/features/SearchBar".
// Re-exported here so existing consumers (e.g. Map) can keep importing it from this module.
export { SearchBar };

export function SortComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tSorts = useTranslations("sorts");

	return (
		<Select
			startContent={<DropDownIcon label="Sort icon" Icon={FaSort} />}
			selectedKeys={
				itemsContext.queryParams.sort && [itemsContext.queryParams.sort]
			}
			onSelectionChange={itemsContext.handleSortChange as any}
			items={SORT_OPTIONS}
			selectorIcon={<div className="hidden"></div>}
			classNames={
				!itemsContext.userData &&
				itemsContext.config.interactionsStyle !== "one-line"
					? {
							base: twMerge(
								"flex-1 max-w-full lg:max-w-56 shrink-0",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: {
							base: twMerge(
								"flex-1 max-w-full min-w-0 lg:min-w-56",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
			}
			label={"Sort by"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tSorts(item.key)} key={item.key}>
						{tSorts(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}

export function ScopeComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tScopes = useTranslations("scopes");

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
								"lg:max-w-72 max-w-full",
								itemsContext.config.interactionsStyle ===
									"one-line" && "flex-1",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-10 lg:h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: {
							base: twMerge(
								"flex-1 max-w-full min-w-0 lg:min-w-56",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
			}
			label={"Search scope"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tScopes(item.key)} key={item.key}>
						{tScopes(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}

function SearchTabContent({
	header,
	itemsContext,
	extraFilters,
	countLabel,
	abstract,
	onAbstractChange,
	view,
	setView,
	showHeader,
	askAI,
}: {
	header: ReactNode;
	itemsContext: ReturnType<typeof useItemsList>;
	extraFilters: ReactNode;
	countLabel: ReactNode;
	abstract: boolean;
	onAbstractChange: (abstract: boolean) => void;
	view: string;
	setView: (view: string) => void;
	showHeader: boolean;
	/** When set, the search field grows an "Ask AI" action. */
	askAI?: (text: string) => void;
}) {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const formatter = useFormatter();
	// Server renders no hint; the client resolves the OS-correct one.
	const shortcutHint = useModEnterHint();
	// Insert the Ask AI button only after a frame has actually been painted
	// without it. If it is inserted before first paint (fast hydration —
	// notably Firefox), its entrance animation runs against frames nobody
	// sees and it appears to just pop in.
	const [revealAskAI, setRevealAskAI] = useState(false);
	useEffect(() => {
		if (!shortcutHint) return;
		let raf2 = 0;
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => setRevealAskAI(true));
		});
		return () => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	}, [shortcutHint]);

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

	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;

	return (
		<div className="flex flex-col gap-4">
			{/* Header with title and explore button */}
			<div className="flex w-full flex-col lg:flex-row lg:justify-between lg:items-end h-24 lg:h-12 gap-4 relative">
				<h1 className="text-black dark:text-white/60 font-medium text-2xl lg:text-3xl w-full lg:w-auto h-10 lg:h-12 flex justify-between items-end">
					<div className="flex items-end gap-4">
						{header || (
							<>
								<a
									href="#collections"
									className="p-3 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100 bg-background_light dark:bg-background"
								>
									{t("goToFilters")}
								</a>
								{showHeader && t("searchTitle")}
							</>
						)}
					</div>
					<Button
						startContent={
							<AiOutlineCompass className="size-6 shrink-0" />
						}
						className="lg:hidden ml-auto rtl:ml-0 rtl:mr-auto h-full"
						onPress={onExploreOpen}
					>
						{t("explore")}
					</Button>
					<ExploreModal
						isOpen={isExploreOpen}
						onOpenChange={onExploreOpenChange}
					/>
				</h1>
				<div className="flex gap-4 h-10 lg:h-12 flex-1 justify-end">
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
							{<SortComponent itemsContext={itemsContext} />}
						</>
					)}
				</div>
			</div>

			{/* Search and filters */}
			{itemsContext.config.interactionsStyle === "one-line" ? (
				<div className="flex gap-4">
					<ScopeComponent itemsContext={itemsContext} />
					<SortComponent itemsContext={itemsContext} />
				</div>
			) : (
				<section
					role="search"
					className={twMerge(
						"lg:flex lg:flex-row gap-4",
						!itemsContext.userData
							? "flex flex-col"
							: "grid grid-cols-2",
					)}
				>
					<SearchBar
						handleSearchChange={itemsContext.handleSearchChange}
						search={itemsContext.queryParams.search}
						focusOnRequest
						// Asking consumes the text as a question — it must not
						// linger as a search filter.
						onCmdEnter={
							askAI &&
							((text: string, clear: () => void) => {
								clear();
								askAI(text);
							})
						}
						endContent={
							askAI &&
							((liveText: string, clear: () => void) =>
								// Client-only: nothing renders until the OS
								// shortcut is known, then the whole button
								// enters with a CSS keyframe animation — CSS
								// animations run unconditionally on DOM
								// insertion, immune to the hydration/
								// StrictMode timing that swallows JS-driven
								// mount animations in dev. Plain button:
								// react-aria press detection breaks inside
								// the Input's endContent.
								revealAskAI &&
								shortcutHint && (
									<button
										type="button"
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											clear();
											askAI(liveText);
										}}
										// NB: no `duration-*` here — tailwindcss-animate
										// makes it override animation-duration
										// and squash the entrance.
										// Compact below lg: the mobile bar is only 40px
										// tall (vs 48px), so the pill slims to 28px with
										// a matching radius, and the keyboard hint (no
										// keyboard on touch) is desktop-only.
										className="flex h-7 shrink-0 animate-rise-in items-center gap-1 self-center rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.97] lg:h-9 lg:gap-1.5 lg:rounded-[10px] lg:pl-3 lg:pr-1.5 lg:text-sm"
									>
										<BsStars className="size-3.5 shrink-0 lg:size-4" />
										{tAI("askAI")}
										<kbd className="ml-0.5 hidden rounded-md bg-white/20 px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium leading-none text-white/90 lg:inline">
											{shortcutHint}
										</kbd>
									</button>
								))
						}
					/>
					{<ScopeComponent itemsContext={itemsContext} />}
					{itemsContext.userData && (
						<SortComponent itemsContext={itemsContext} />
					)}
					{extraFilters}
				</section>
			)}

			{/* Results count and view controls */}
			<section className="flex justify-between h-10 lg:h-12 gap-8">
				<Skeleton
					isLoaded={!!itemsContext.itemsData}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center whitespace-pre relative"
					>
						<div className="flex flex-col md:flex-row md:items-center items-start md:gap-2 whitespace-normal">
							{countLabel ||
								t.rich("resourcesCount", {
									count: formatter.number(
										actuallyNoData
											? 0
											: itemsContext.itemsData
													?.totalItems || 0,
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
						</div>
						{itemsContext.isItemsFetching && (
							<div className="flex items-center !size-0 absolute ltr:-right-4 rtl:-left-4 translate-x-full">
								<Spinner
									size="sm"
									className="opacity-60 absolute"
								/>
							</div>
						)}
					</h2>
				</Skeleton>
				<section
					className={twMerge(
						"flex gap-4",
						itemsContext.config.interactionsStyle === "multi-line"
							? "lg:min-w-72"
							: "flex-1",
					)}
				>
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
					{!itemsContext.config.disableViewSwitch && (
						<div className="hidden lg:flex gap-0 w-28">
							<Button
								color={
									view === "list" ? "tertiary" : "secondary"
								}
								isIconOnly
								className="!p-0 ltr:rounded-r-none rtl:rounded-l-none flex-1"
								onPress={() => setView("list")}
								aria-label={t("viewAsListAriaLabel")}
							>
								<HiOutlineViewList
									aria-label={t("viewAsListAriaLabel")}
									className="size-6"
								/>
							</Button>
							<Button
								color={
									view === "grid" ? "tertiary" : "secondary"
								}
								isIconOnly
								className="!p-0 ltr:rounded-l-none rtl:rounded-r-none flex-1"
								onPress={() => setView("grid")}
								aria-label={t("viewAsGridAriaLabel")}
							>
								<IoGrid
									aria-label={t("viewAsGridAriaLabel")}
									className="size-4"
								/>
							</Button>
						</div>
					)}
				</section>
			</section>
			{!itemsContext.userData && <MeaningResultNote />}
		</div>
	);
}

export function useIsAISearchEnabled() {
	const isAISearchFeatureEnabled = useFeatureFlagEnabled("ai-search");
	const isDeepResearchEnabled = useFeatureFlagEnabled("deep-research");
	const { data: aiStatus } = useSWR<{ enabled: boolean }>(
		"/ai/status",
		fetcher,
	);
	const isAISearchEnabled =
		isAISearchFeatureEnabled && aiStatus?.enabled === true;
	return {
		isAISearchEnabled,
		isDeepResearchEnabled: isAISearchEnabled && isDeepResearchEnabled,
	};
}

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
		isOpen: isChatOpen,
		onOpen: onChatOpen,
		onOpenChange: onChatOpenChange,
	} = useDisclosure();
	const { selectedModel, setSelectedModel } = useSelectedModel();
	// Gate on the server-provided flag only: the async /ai/status check made
	// the Ask AI button pop in late. If AI turns out to be down, the chat
	// itself surfaces the error.
	const isAISearchFlagEnabled = useFeatureFlagEnabled("ai-search");
	const [externalInput, setExternalInput] = useState<string>("");
	const searchContext = itemsContext.userData
		? undefined
		: normalizeLibrarySearchContext(itemsContext.queryParams);
	const { setEngaged, setPendingInput, setPendingSend } =
		useInlineChatLayout();
	const canUseInlineChat = !itemsContext.userData;

	// One search field, two verbs: typing filters the library live, "Ask AI"
	// (or Cmd+Enter) hands the text to the chat.
	const askAI = (text: string) => {
		const trimmed = text.trim();
		if (canUseInlineChat) {
			setPendingInput(trimmed);
			setPendingSend(trimmed.length > 0);
			setEngaged(true);
			return;
		}
		setExternalInput(trimmed);
		onChatOpen();
	};

	return (
		<div className="relative">
			<ChatModal
				key={selectedModel}
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				modelId={selectedModel}
				externalInput={externalInput}
				setExternalInput={setExternalInput}
				searchContext={searchContext}
				onModelChange={setSelectedModel}
			/>
			<SearchTabContent
				header={header}
				itemsContext={itemsContext}
				extraFilters={extraFilters}
				countLabel={countLabel}
				abstract={abstract}
				onAbstractChange={onAbstractChange}
				view={view}
				setView={setView}
				showHeader
				askAI={isAISearchFlagEnabled ? askAI : undefined}
			/>
		</div>
	);
}

function MainContent() {
	const props = useItemsList();
	const { engaged } = useInlineChatLayout();
	const prefersReducedMotion = useReducedMotion();

	return (
		<>
			{/*
			 * Two layers: the outer div animates the layout space (width),
			 * while the inner card keeps its natural width and slides under
			 * the chat panel (which paints above it) instead of being
			 * clipped by the collapsing box.
			 */}
			<motion.div
				initial={false}
				// Height collapses too: a width-0 sidebar would otherwise
				// still set the row's height, leaving a long blank scroll
				// under a short result list in split mode.
				animate={{
					width: engaged ? 0 : "auto",
					height: engaged ? 0 : "auto",
					marginRight: engaged ? "-2.5rem" : "0rem",
				}}
				// Close: reclaim width on exactly the grid track's curve and
				// delay (see ResourcesView) so the results column grows
				// monotonically into its final width — a spring here races
				// the track and squeezes the results before they can open.
				transition={
					engaged
						? // Open: same expo-out clock as the grid track, so the
							// results column's width changes on one curve.
							{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }
						: {
								// Slightly behind the track's 80ms: fr tracks
								// lag in pixel terms early in their curve.
								delay: 0.13,
								duration: 0.42,
								ease: [0.16, 1, 0.3, 1],
							}
				}
				inert={engaged || undefined}
				className={twMerge(
					"hidden shrink-0 lg:block",
					engaged && "pointer-events-none",
				)}
			>
				<motion.div
					initial={false}
					animate={
						engaged
							? { opacity: 0, x: prefersReducedMotion ? 0 : 48 }
							: { opacity: 1, x: 0 }
					}
					transition={
						engaged
							? { duration: 0.35, ease: "easeOut" }
							: {
									delay: 0.2,
									type: "spring",
									bounce: 0.15,
									duration: 0.55,
								}
					}
					className="lg:w-[24rem] xl:w-[28.5rem]"
				>
					<CollectionsList
						data={props.collectionsData}
						handleCheckboxChange={props.handleCheckboxChange}
						selectedCollections={props.selectedCollections}
						hierarchy={props.hierarchy}
						range={props.queryParams.range}
						handleRangeChange={props.handleRangeChange}
						facetDistribution={props.facetDistribution}
						queryParams={props.queryParams}
						handleInstitutionSelect={props.handleInstitutionSelect}
						handleCountrySelect={props.handleCountrySelect}
						handleAuthorCountrySelect={
							props.handleAuthorCountrySelect
						}
					/>
				</motion.div>
			</motion.div>
			{/* Mobile filters live in the Explore modal; the sidebar's
			    non-modal root is hidden below lg, so no mobile copy here —
			    an empty one still costs a gap slot above the content. */}
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

export function SmartScreeningModal({
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
		[],
	);
	const [localFields, setLocalFields] = useState<SmartScreeningField[]>(
		() => [...fields],
	);
	const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
	const placeholderExample = `${t("label")} (${smartScreeningFieldTypes.join(
		" | ",
	)}): ${t("description")}`;

	const fieldSchema = z.object({
		label: z
			.string()
			.min(1, t("labelRequired"))
			.max(
				SMART_SCREENING_LIMITS.labelCharacters,
				t("labelTooLong", {
					count: SMART_SCREENING_LIMITS.labelCharacters,
				}),
			),
		type: z.enum(["string", "number", "boolean"]),
		description: z
			.string()
			.min(
				SMART_SCREENING_LIMITS.descriptionCharacters.min,
				t("descriptionMin20"),
			)
			.max(
				SMART_SCREENING_LIMITS.descriptionCharacters.max,
				t("descriptionTooLong", {
					count: SMART_SCREENING_LIMITS.descriptionCharacters.max,
				}),
			),
	});

	const convertedText = fields
		.map(
			(field) =>
				`${field.label.trim()} (${
					field.type
				}): ${field.description.trim()}`,
		)
		.join("\n");

	const validatorFunction = (localFields: SmartScreeningField[]) => {
		const newErrors: Record<number, string> = {};
		let hasErrors = false;
		if (localFields.length > SMART_SCREENING_LIMITS.fields) {
			newErrors[SMART_SCREENING_LIMITS.fields] = t(
				"tooManyScreeningFields",
				{ count: SMART_SCREENING_LIMITS.fields },
			);
			hasErrors = true;
		}

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
						newErrors[index] = `${t("fieldPrefix")} ${index + 1} ${
							field.label
						}: ${fieldError}`;
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
						<AIHeader onClose={onClose}>
							{t("smartScreening")}
						</AIHeader>
						<div className="flex gap-0 px-6 py-2">
							{tabs.map((t, i) => (
								<Button
									key={t}
									size="md"
									color={tab === t ? "accent" : "secondary"}
									className={twMerge(
										"rounded-none",
										t === tabs[0] && "rounded-l-2xl",
										t === tabs.at(-1) && "rounded-r-2xl",
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
																placeholder={t(
																	"label",
																)}
																label={t(
																	"label",
																)}
																value={
																	field.label
																}
																maxLength={
																	SMART_SCREENING_LIMITS.labelCharacters
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
																				i,
																			) =>
																				i ===
																				index
																					? {
																							...f,
																							label: e
																								.target
																								.value,
																						}
																					: f,
																		),
																	)
																}
															/>
															<Textarea
																placeholder={t(
																	"description",
																)}
																label={t(
																	"description",
																)}
																value={
																	field.description
																}
																maxLength={
																	SMART_SCREENING_LIMITS
																		.descriptionCharacters
																		.max
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
																				i,
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
																					: f,
																		),
																	)
																}
																classNames={{
																	inputWrapper:
																		"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
																	input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
																}}
															/>
															<div className="flex justify-between">
																<Select
																	color="tertiary"
																	label={t(
																		"typeLabel",
																	)}
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
																		value,
																	) => {
																		const selectedType =
																			Array.from(
																				value,
																			)[0] as (typeof smartScreeningFieldTypes)[number];
																		setLocalFields(
																			localFields.map(
																				(
																					f,
																					i,
																				) =>
																					i ===
																					index
																						? {
																								...f,
																								type: selectedType,
																							}
																						: f,
																			),
																		);
																	}}
																>
																	{smartScreeningFieldTypes.map(
																		(
																			type,
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
																		),
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
																					i,
																				) =>
																					i !==
																					index,
																			),
																		)
																	}
																	className="!p-0"
																>
																	<BiTrash className="size-4" />
																</Button>
															</div>
														</motion.div>
													),
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
													input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
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
										isDisabled={
											localFields.length >=
											SMART_SCREENING_LIMITS.fields
										}
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

export default function EvidenceLibrary() {
	const { engaged } = useInlineChatLayout();
	return (
		<PageContainer
			className={twMerge(
				// Same clock as the grid reflow (ResourcesView) so the page
				// settles in one motion, not two.
				"transition-[padding] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
				// In split chat mode: overflow-hidden would break the chat
				// panel's sticky positioning (main becomes the sticky
				// scrollport), and the default top padding leaves a dead band
				// under the shrunken navbar.
				// The scaled navbar still occupies its full layout height, so
				// its visual shrink already leaves a gap — no top padding
				// needed at xl.
				engaged && "overflow-visible pt-4 lg:pt-5 xl:pt-0",
			)}
		>
			{/* Inline-size container: the split view's chat column pins its
			    width to a fraction of this (stable) row width so its content
			    never reflows while the grid track animates. */}
			<div className="flex xl:gap-[2.5rem] gap-8 flex-col lg:flex-row lg:[container-type:inline-size]">
				<MainContent />
			</div>
		</PageContainer>
	);
}
