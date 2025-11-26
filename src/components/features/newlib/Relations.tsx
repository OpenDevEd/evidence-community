"use client";

import { RelationsType } from "@/types/item";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { MdSearchOff } from "react-icons/md";
import { Item } from "@/app/api/item/types";
import Resource from "../items/Resource";
import { useTranslations } from "next-intl";
import { ItemsBatchResponse } from "@/app/api/items/batch/route";
import { useMemo, useState, ReactNode } from "react";
import { Tabs, Tab } from "@/components/nextui/Tabs";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { useBreakpointBelow } from "@/hooks/useBreakpoint";
import { Spinner } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";

function extractGeneralRelationKeys(relations: RelationsType): string[] {
	const obj = relations || {};
	const relationsObject = {
		"dc:relation": obj["dc:relation"] || [],
		"owl:sameAs": obj["owl:sameAs"] || [],
		related_works: obj["related_works"] || [],
	};

	const keys: string[] = [];
	Object.values(relationsObject).forEach((value) => {
		const valueArray = Array.isArray(value) ? value : [value];
		valueArray.forEach((v) => {
			const key = typeof v === "string" ? v.split("/").pop() : null;
			if (key) keys.push(key);
		});
	});

	return keys;
}

function extractCitesKeys(relations: RelationsType): string[] {
	const obj = relations || {};
	const cites = obj["cites"] || [];
	return Array.isArray(cites) ? cites : [];
}

function extractCitedByKeys(relations: RelationsType): string[] {
	const obj = relations || {};
	const citedBy = obj["citedBy"] || [];
	return Array.isArray(citedBy) ? citedBy : [];
}

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
}: {
	keys: string[];
	isLoading: boolean;
	items: Item[];
}) {
	const hasItems = isLoading || items.length > 0;

	return (
		<ul className="flex flex-col md:grid grid-cols-2 gap-4">
			<AnimatePresence mode="popLayout">
				{isLoading
					? // Show loading skeletons
					  keys.map((key) => (
							<motion.li
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.3 }}
								key={key}
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
					  items.map((item: Item) => (
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
						<MdSearchOff className="size-6" />
						No items found
					</div>
				</div>
			)}
		</ul>
	);
}

export default function Relations({
	value,
	selectedTab,
	onTabChange,
	showTabsOnly,
	showContentOnly,
}: {
	value: RelationsType;
	selectedTab?: string;
	onTabChange?: (key: string) => void;
	showTabsOnly?: boolean;
	showContentOnly?: boolean;
}) {
	const t = useTranslations("ui");
	const isMobile = useBreakpointBelow("md");
	const [internalSelectedTab, setInternalSelectedTab] = useState("general");
	const activeTab = selectedTab ?? internalSelectedTab;
	const handleTabChange = onTabChange ?? setInternalSelectedTab;

	const generalKeys = useMemo(() => extractGeneralRelationKeys(value), [value]);
	const citesKeys = useMemo(() => extractCitesKeys(value), [value]);
	const citedByKeys = useMemo(() => extractCitedByKeys(value), [value]);

	const { data: generalData, isLoading: generalLoading } =
		useSWR<ItemsBatchResponse>(
			generalKeys.length > 0
				? `/items/batch?keys=${generalKeys.join(",")}`
				: null,
			fetcher,
			{
				revalidateOnFocus: false,
				revalidateIfStale: false,
				revalidateOnReconnect: false,
				shouldRetryOnError: false,
			}
		);

	const { data: citesData, isLoading: citesLoading } =
		useSWR<ItemsBatchResponse>(
			citesKeys.length > 0 ? `/items/batch?keys=${citesKeys.join(",")}` : null,
			fetcher,
			{
				revalidateOnFocus: false,
				revalidateIfStale: false,
				revalidateOnReconnect: false,
				shouldRetryOnError: false,
			}
		);

	const { data: citedByData, isLoading: citedByLoading } =
		useSWR<ItemsBatchResponse>(
			citedByKeys.length > 0
				? `/items/batch?keys=${citedByKeys.join(",")}`
				: null,
			fetcher,
			{
				revalidateOnFocus: false,
				revalidateIfStale: false,
				revalidateOnReconnect: false,
				shouldRetryOnError: false,
			}
		);

	const generalItems = generalData?.items ?? [];
	const citesItems = citesData?.items ?? [];
	const citedByItems = citedByData?.items ?? [];

	const tabs = [
		{
			key: "general",
			label: t("relatedResources"),
			keys: generalKeys,
			items: generalItems,
			isLoading: generalLoading,
			count: generalLoading ? generalKeys.length : generalItems.length,
		},
		{
			key: "cites",
			label: t("cites"),
			keys: citesKeys,
			items: citesItems,
			isLoading: citesLoading,
			count: citesLoading ? citesKeys.length : citesItems.length,
		},
		{
			key: "citedBy",
			label: t("citedBy"),
			keys: citedByKeys,
			items: citedByItems,
			isLoading: citedByLoading,
			count: citedByLoading ? citedByKeys.length : citedByItems.length,
		},
	];

	if (showTabsOnly) {
		if (isMobile) {
			const selectedTabData = tabs.find((tab) => tab.key === activeTab) || tabs[0];
			
			return (
				<Select
					selectedKeys={activeTab ? [activeTab] : []}
					onSelectionChange={(keys) => {
						const selectedKey = Array.from(keys)[0] as string;
						if (selectedKey) handleTabChange(selectedKey);
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
		
		return (
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
					/>
				))}
			</Tabs>
		);
	}

	if (showContentOnly) {
		const activeTabData = tabs.find((tab) => tab.key === activeTab) || tabs[0];
		return (
			<RelationsList
				keys={activeTabData.keys}
				isLoading={activeTabData.isLoading}
				items={activeTabData.items}
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
						/>
					</Tab>
				))}
			</Tabs>
		</div>
	);
}
