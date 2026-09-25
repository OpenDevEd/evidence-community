"use client";

import { AuthorProfilesContext, useAuthorProfiles } from "@/lib/authors/use-author-profiles";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { SearchRemoveIcon } from "@hugeicons/core-free-icons";
import type { ItemLinks } from "@/app/api/item/types";
import { RelationsType } from "@/types/item";
import useSWR from "swr";
import { fetcherPOST } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ListItem } from "@/app/api/item/types";
import Resource from "../items/Resource";
import { useTranslations } from "next-intl";
import { ItemsBatchResponse } from "@/app/api/items/batch/route";
import { use, useState } from "react";
import { EntranceContext } from "@/components/features/newlib/entrance";
import { Tabs, Tab } from "@/components/nextui/Tabs";
import { Pagination } from "@/components/nextui/Pagination";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Spinner } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { planRelationTabs, type RelationTabKey } from "./relation-tabs";

function CountBadge({ count, isLoading, className = "" }: { count: number; isLoading: boolean; className?: string }) {
	return (
		<span className={twMerge("inline-flex items-center justify-center gap-1 min-w-[1.5rem] h-5 px-1.5 text-xs font-medium rounded-full bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60 transition-size", className)}>
			{isLoading && <Spinner size="sm" classNames={{
				base: "scale-50"
			}} />}
			{!isLoading && count}
		</span>
	);
}

function RelationsList({
	keys,
	isLoading,
	items,
	totalPages,
	currentPage,
	onPageChange,
}: {
	keys: string[];
	isLoading: boolean;
	items: ListItem[];
	totalPages: number;
	currentPage: number;
	onPageChange: (page: number) => void;
}) {
	const { profiles } = useAuthorProfiles(items?.flatMap(item => item.creators ?? []));
	const hasItems = isLoading || items.length > 0;

	return (
		<AuthorProfilesContext value={profiles}>
			<div className="flex flex-col gap-6">
				<ul className="flex flex-col md:grid grid-cols-2 gap-4">
					<AnimatePresence mode="popLayout" initial={use(EntranceContext)}>
						{isLoading
							? // Show loading skeletons
							  Array.from({ length: 4 }).map((_, index) => (
									<motion.li
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.3 }}
										key={`skeleton-${index}`}
										layout
									>
										<Resource
											as="div"
											itemData={undefined}
											isLoading={true}
											abstract={false}
											className="h-full"
											hideUnapi={true}
										/>
									</motion.li>
							  ))
							: // Show fetched items
							  items.map((item: ListItem) => (
									<motion.li
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.3 }}
										key={item.key}
										layout
									>
										<Resource
											as="div"
											itemData={item}
											isLoading={false}
											abstract={false}
											className="h-full"
											hideUnapi={true}
										/>
									</motion.li>
							  ))}
					</AnimatePresence>
					{!hasItems && (
						<div className="col-span-2">
							<div className="flex gap-2">
								<HugeiconsIcon icon={SearchRemoveIcon} className="size-6" />
								No items found
							</div>
						</div>
					)}
				</ul>
				{totalPages > 1 && (
					<div className="flex justify-center">
						<Pagination
							total={totalPages}
							page={currentPage}
							onChange={onPageChange}
							showControls
						/>
					</div>
				)}
			</div>
		</AuthorProfilesContext>
	);
}

type RelationTab = {
	key: string;
	label: string;
	keys: string[];
	items: ListItem[];
	isLoading: boolean;
	count: number;
	totalPages: number;
	currentPage: number;
	onPageChange: (page: number) => void;
};

function RelationsSelectTabs({
	tabs,
	activeTab,
	onTabChange,
}: {
	tabs: RelationTab[];
	activeTab: string;
	onTabChange: (key: string) => void;
}) {
	return (
		<Select
			selectedKeys={activeTab ? [activeTab] : []}
			onSelectionChange={(keys) => {
				const selectedKey = Array.from(keys)[0] as string;
				if (selectedKey) onTabChange(selectedKey);
			}}
			aria-label="Relations selector"
			classNames={{
				base: "w-full max-w-full",
				trigger: "w-full",
				mainWrapper: "w-full",
				value: "flex items-center gap-2 text-black/80 dark:text-white/60 px-2",
				selectorIcon: "!size-6 text-black/60 dark:text-white/60",
			}}
			renderValue={(items) => {
				const selected = items[0];
				const tab = tabs.find((t) => t.key === selected?.key) || tabs[0];
				return (
					<div className="flex items-center gap-2">
						<span>{tab.label}</span>
						<CountBadge count={tab.count} isLoading={tab.isLoading} />
					</div>
				);
			}}
		>
			{tabs.map((tab) => (
				<SelectItem key={tab.key} value={tab.key} textValue={`${tab.label} (${tab.count})`}>
					<div className="flex items-center justify-between w-full">
						<span>{tab.label}</span>
						<CountBadge count={tab.count} isLoading={tab.isLoading} className="ml-2" />
					</div>
				</SelectItem>
			))}
		</Select>
	);
}

function RelationsDesktopTabs({
	tabs,
	activeTab,
	onTabChange,
}: {
	tabs: RelationTab[];
	activeTab: string;
	onTabChange: (key: string) => void;
}) {
	return (
		<Tabs
			selectedKey={activeTab}
			onSelectionChange={(key) => onTabChange(key as string)}
			aria-label="Relations tabs"
		>
			{tabs.map((tab) => (
				<Tab
					key={tab.key}
					title={
						<div className="flex items-center gap-2">
							<span>{tab.label}</span>
							<CountBadge count={tab.count} isLoading={tab.isLoading} />
						</div>
					}
				/>
			))}
		</Tabs>
	);
}

function useRelationItems(keys: string[], page: number) {
	return useSWR<ItemsBatchResponse>(
		keys.length > 0 ? [`/items/batch`, { keys, page, perPage: 20 }] : null,
		fetcherPOST,
		{
			revalidateOnFocus: false,
			revalidateIfStale: false,
			revalidateOnReconnect: false,
			shouldRetryOnError: false,
			keepPreviousData: true,
		},
	);
}

export default function Relations({
	links,
	relations,
	selectedTab,
	onTabChange,
	showTabsOnly,
	showContentOnly,
}: {
	links: ItemLinks | undefined;
	relations: RelationsType;
	selectedTab?: string;
	onTabChange?: (key: string) => void;
	showTabsOnly?: boolean;
	showContentOnly?: boolean;
}) {
	const t = useTranslations("ui");
	const [internalSelectedTab, setInternalSelectedTab] = useState("general");
	const requestedTab = selectedTab ?? internalSelectedTab;
	const handleTabChange = onTabChange ?? setInternalSelectedTab;

	const [pages, setPages] = useState<Record<RelationTabKey, number>>({
		general: 1,
		cites: 1,
		citedBy: 1,
	});

	const handlePageChange = (key: RelationTabKey, page: number) => {
		setPages((prev) => ({ ...prev, [key]: page }));
		const element = document.getElementById("relations-tabs");
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	};

	const plan = planRelationTabs({ activeTab: requestedTab, links, relations });
	const activeTab = plan.activeTab;
	const keysFor = (key: RelationTabKey) =>
		plan.tabs.find((tab) => tab.key === key)?.keys ?? [];

	const { data: generalData, isLoading: generalLoading } = useRelationItems(
		keysFor("general"),
		pages.general,
	);
	const { data: citesData, isLoading: citesLoading } = useRelationItems(
		keysFor("cites"),
		pages.cites,
	);
	const { data: citedByData, isLoading: citedByLoading } = useRelationItems(
		keysFor("citedBy"),
		pages.citedBy,
	);

	const labels: Record<RelationTabKey, string> = {
		general: t("relatedResources"),
		cites: t("cites"),
		citedBy: t("citedBy"),
	};
	const dataFor: Record<
		RelationTabKey,
		{ data: ItemsBatchResponse | undefined; isLoading: boolean }
	> = {
		general: { data: generalData, isLoading: generalLoading },
		cites: { data: citesData, isLoading: citesLoading },
		citedBy: { data: citedByData, isLoading: citedByLoading },
	};

	const tabs: RelationTab[] = plan.tabs.map(({ key, keys }) => ({
		key,
		label: labels[key],
		keys,
		items: dataFor[key].data?.items ?? [],
		isLoading: dataFor[key].isLoading,
		count: dataFor[key].data?.total ?? keys.length,
		totalPages: dataFor[key].data?.totalPages ?? 1,
		currentPage: pages[key],
		onPageChange: (page: number) => handlePageChange(key, page),
	}));

	if (showTabsOnly) {
		return (
			<div id="relations-tabs" className="scroll-mt-24 md:scroll-mt-6">
				<div className="md:hidden">
					<RelationsSelectTabs
						tabs={tabs}
						activeTab={activeTab}
						onTabChange={handleTabChange}
					/>
				</div>
				<div className="hidden md:block">
					<RelationsDesktopTabs
						tabs={tabs}
						activeTab={activeTab}
						onTabChange={handleTabChange}
					/>
				</div>
			</div>
		);
	}

	if (showContentOnly) {
		const activeTabData = tabs.find((tab) => tab.key === activeTab) || tabs[0];
		return (
			<RelationsList
				keys={activeTabData.keys}
				isLoading={activeTabData.isLoading}
				items={activeTabData.items}
				totalPages={activeTabData.totalPages}
				currentPage={activeTabData.currentPage}
				onPageChange={activeTabData.onPageChange}
			/>
		);
	}

	return (
		<div>
			<Tabs
				selectedKey={activeTab}
				onSelectionChange={(key) => handleTabChange(key as string)}
				aria-label="Relations tabs"
			>
				{tabs.map((tab) => (
					<Tab
						key={tab.key}
						title={
							<div className="flex items-center gap-2">
								<span>{tab.label}</span>
								<CountBadge count={tab.count} isLoading={tab.isLoading} />
							</div>
						}
					>
						<RelationsList
							keys={tab.keys}
							isLoading={tab.isLoading}
							items={tab.items}
							totalPages={tab.totalPages}
							currentPage={tab.currentPage}
							onPageChange={tab.onPageChange}
						/>
					</Tab>
				))}
			</Tabs>
		</div>
	);
}
