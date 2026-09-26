"use client";

import { useCallback, useState, type ReactNode } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { MessageSquareQuoteIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { Spinner } from "@/components/nextui/Spinner";
import { CitationStylePicker } from "./CitationStylePicker";
import { CitationText } from "./CitationText";
import CopyButton from "@/components/features/newlib/CopyButton";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	CITATION_FORMATS,
	type CitationStyle,
	type CitationResponse,
	type FormattedCitation,
} from "@/lib/citation-formats";
import { canCiteItem, type CitationItem } from "@/lib/citation-formats";
import {
	citationSource,
	loadCitations,
	loadAdditionalCitation,
	type CitationRequest,
} from "@/lib/citation-client";
import { useCitationStyle } from "@/hooks/useCitationStyle";
import { buildSiteUrl } from "@/lib/site-url";

function CitationContent({
	loading,
	failed,
	citation,
	retry,
}: {
	loading: boolean;
	failed: boolean;
	citation?: FormattedCitation;
	retry: () => void;
}) {
	const t = useTranslations("ui");
	const reducedMotion = useReducedMotion();
	const [height, setHeight] = useState<number>();
	const measure = useCallback((element: HTMLDivElement | null) => {
		if (!element) return;
		setHeight(element.offsetHeight);
		const observer = new ResizeObserver(([entry]) => {
			setHeight(entry.borderBoxSize[0].blockSize);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const [displayed, setDisplayed] = useState(citation);
	if (citation && citation !== displayed) setDisplayed(citation);
	const showSpinner = loading && !failed && !displayed;
	return (
		<LazyMotion features={domAnimation}>
			<m.div
				initial={false}
				animate={{ height: height ?? "auto" }}
				transition={{
					duration: reducedMotion ? 0 : 0.24,
					ease: [0.22, 1, 0.36, 1],
				}}
				data-loading={showSpinner}
				className="group/citation relative overflow-hidden"
			>
				<div
					role="status"
					aria-label={t("loadingData")}
					aria-hidden={!showSpinner}
					className="invisible absolute inset-x-0 top-0 flex h-12 items-center justify-center opacity-0 transition-[opacity,visibility] duration-150 group-data-[loading=true]/citation:visible group-data-[loading=true]/citation:opacity-100 motion-reduce:transition-none"
				>
					<Spinner
						size="sm"
						aria-hidden="true"
						classNames={{
							circle1: "group-data-[loading=false]/citation:animate-none motion-reduce:animate-none",
							circle2: "group-data-[loading=false]/citation:animate-none motion-reduce:animate-none",
						}}
					/>
				</div>
				<div ref={measure} className="group-data-[loading=true]/citation:h-12">
					<div className="opacity-100 transition-opacity duration-150 group-data-[loading=true]/citation:opacity-0 motion-reduce:transition-none">
						{failed ? (
							<div role="alert" className="space-y-2 text-sm">
								<p>{t("citationLoadFailed")}</p>
								<Button size="sm" onPress={retry}>
									{t("retry")}
								</Button>
							</div>
						) : (
							<div
								className="max-h-72 overflow-y-auto text-black/70 dark:text-white/70"
								aria-live="polite"
								aria-busy={loading}
							>
								{displayed && <CitationText citation={displayed} />}
							</div>
						)}
					</div>
				</div>
			</m.div>
		</LazyMotion>
	);
}

function CitationActions({
	format,
	onFormatChange,
	text,
	disabled,
}: {
	format: CitationStyle | undefined;
	onFormatChange: (format: CitationStyle) => void;
	text?: string;
	disabled: boolean;
}) {
	const t = useTranslations("ui");
	return (
		<div className="flex max-w-full items-center justify-between gap-1">
			<CitationStylePicker
				selected={format}
				onSelect={onFormatChange}
				className="min-w-0 max-w-none flex-1 sm:max-w-none"
			/>
			<span className="inline-flex size-8 shrink-0">
				<CopyButton
					key={text}
					textToCopy={text ?? ""}
					isDisabled={disabled || !text}
					ariaLabel={t("copyCitation")}
				/>
			</span>
		</div>
	);
}

function useCitationResult(
	request: CitationRequest,
	format: CitationStyle,
	enabled: boolean,
) {
	const base = useSWR<CitationResponse>(
		enabled ? request : null,
		loadCitations,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		},
	);
	const record = format.asset && base.data?.record;
	const extra = useSWR(
		record
			? ([
					"citation-style",
					record,
					request[2],
					format,
					request[3],
				] as const)
			: null,
		loadAdditionalCitation,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		},
	);
	const current = record ? extra : base;
	const citation =
		format.asset !== undefined
			? extra.data
			: base.data?.citations?.[format.id];
	return {
		citation,
		loading: current.isLoading,
		failed: Boolean(current.error),
		available: base.data?.citations !== null,
		retry: () => {
			void current.mutate();
		},
	};
}

function CitationPanelLayout({
	showHeading,
	loading,
	failed,
	controls,
	children,
}: {
	showHeading: boolean;
	loading: boolean;
	failed: boolean;
	controls: ReactNode;
	children: ReactNode;
}) {
	const t = useTranslations("ui");
	return (
		<div
			className={`w-full space-y-3 ${showHeading ? "text-base" : "text-sm"}`}
			data-citation-state={
				failed ? "error" : loading ? "loading" : "ready"
			}
		>
			{showHeading ? (
				<ItemPropertyRowWrapper
					title={t("itemCitationTitle")}
					actions={controls}
				>
					{children}
				</ItemPropertyRowWrapper>
			) : (
				<>
					{controls}
					{children}
				</>
			)}
		</div>
	);
}

export function CitationPanel({
	item,
	showHeading = false,
	completeRecord = false,
	link,
}: {
	item: CitationItem;
	showHeading?: boolean;
	completeRecord?: boolean;
	/** Where the cited thing lives, when it is not a publication page in the library (the library itself). */
	link?: string;
}) {
	const locale = useLocale();
	const { citations: settings, identity } = useLibraryConfig();
	const {
		style: format,
		setStyle: setFormat,
		error: styleError,
		retry: retryStyle,
	} = useCitationStyle();
	const source = citationSource(item, completeRecord);
	const request: CitationRequest = [
		"citations",
		source,
		locale,
		settings.showUrl
			? (link ?? buildSiteUrl(`/lib/${item.key}`, identity.baseUrl))
			: undefined,
	];
	const {
		citation: formattedCitation,
		loading: formatting,
		failed,
		available,
		retry,
	} = useCitationResult(
		request,
		format ?? CITATION_FORMATS[0],
		settings.enabled,
	);
	const citation = format ? formattedCitation : undefined;
	const loading = !format || formatting;
	if (!settings.enabled || !available) return null;
	const controls = (
		<CitationActions
			format={format}
			onFormatChange={setFormat}
			text={citation?.text}
			disabled={loading || failed || Boolean(styleError)}
		/>
	);
	const content = (
		<CitationContent
			key={item.key}
			loading={loading}
			failed={failed || Boolean(styleError)}
			citation={citation}
			retry={styleError ? retryStyle : retry}
		/>
	);
	return (
		<CitationPanelLayout
			showHeading={showHeading}
			loading={loading}
			failed={failed || Boolean(styleError)}
			controls={controls}
		>
			{content}
		</CitationPanelLayout>
	);
}

export function CitationControl({ item }: { item: CitationItem | undefined }) {
	const t = useTranslations("ui");
	const { citations, identity } = useLibraryConfig();
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	if (!citations.enabled || !canCiteItem(item)) return null;
	const prepare = () => {
		const request: CitationRequest = [
			"citations",
			citationSource(item, false),
			locale,
			citations.showUrl
				? buildSiteUrl(`/lib/${item.key}`, identity.baseUrl)
				: undefined,
		];
		void preload(request, loadCitations).catch(() => {
			/* The panel exposes retry if the request fails. */
		});
	};
	return (
		<Popover
			isOpen={open}
			onOpenChange={setOpen}
			placement="bottom-end"
			// Focus changes in the nested style menu may scroll the page.
			shouldCloseOnScroll={false}
		>
			<PopoverTrigger>
				<Button
					onPointerEnter={prepare}
					onFocus={prepare}
					size="sm"
					aria-label={t("cite")}
					startContent={
						<HugeiconsIcon icon={MessageSquareQuoteIcon} className="size-4" />
					}
					className="px-0 min-w-0 aspect-square @[720px]:aspect-auto @[720px]:px-3"
				>
					<span className="hidden @[720px]:inline">{t("cite")}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 max-w-full sm:w-96 items-stretch rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-secondary">
				{open && <CitationPanel key={item.key} item={item} />}
			</PopoverContent>
		</Popover>
	);
}
