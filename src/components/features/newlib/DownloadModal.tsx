"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	Listbox,
	ListboxItem,
	ModalBody,
	ModalContent,
	type PropsOf,
	useDisclosure,
} from "@nextui-org/react";
import GenericHeader from "../modals/GenericHeader";
import DialogModal from "@/components/nextui/DialogModal";
import { Button } from "@/components/nextui/Button";
import type { Item } from "@/app/api/item/types";
import { convertItem } from "@/lib/actions";
import {
	getEnabledCitationFormats,
	getLibraryExportExtension,
	type BibliographicExportFormat,
} from "@/config/library-config/exports";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { toast } from "@/components/layout/Toast";
import { trackContentAction } from "@/lib/analytics";
import { DownloadError, downloadFile, saveDownload } from "@/lib/download";
import { CitationStylePicker } from "@/components/features/items/CitationStylePicker";
import { useCitationStyle } from "@/hooks/useCitationStyle";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citation-formats";

type DownloadFormat = BibliographicExportFormat | "txt" | "html";

export function DownloadButton({
	action,
	fileName,
	itemData,
	...props
}: PropsOf<typeof Button> & {
	action?: (format: BibliographicExportFormat) => Promise<string>;
	fileName: string;
	itemData?: Item;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const isDownloadEnabled = useLibraryFeature("downloads");
	if (!isDownloadEnabled) return null;
	return (
		<>
			<Button {...props} onPress={onOpen}>
				{props.children}
			</Button>
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				source={{
					fileName,
					citationPath: itemData?.key
						? `/api/item/${encodeURIComponent(itemData.key)}/export/citation`
						: undefined,
					action: action ?? (async (format) => {
						if (!itemData) throw new Error("Item data is required for download");
						return convertItem(itemData, format);
					}),
				}}
			/>
		</>
	);
}

function CitationDownloads({
	loading,
	disabled,
	onDownload,
}: {
	loading: DownloadFormat | null;
	disabled: boolean;
	onDownload: (format: "txt" | "html", style: CitationStyle) => void;
}) {
	const t = useTranslations("ui");
	const { style, setStyle, error, retry } = useCitationStyle();
	const selected = style?.id === "bibtex" ? CITATION_FORMATS[0] : style;
	return (
		<section className="space-y-3" aria-label={t("itemCitationTitle")}>
			<h3 className="text-base font-medium">{t("itemCitationTitle")}</h3>
			<CitationStylePicker
				selected={selected}
				onSelect={setStyle}
				excludeBibtex
				isDisabled={disabled || Boolean(loading)}
				className="h-10 min-h-10 w-full max-w-full sm:max-w-full px-3"
			/>
			{error ? (
				<div role="alert" className="text-sm">
					<p>{t("citationLoadFailed")}</p>
					<Button size="sm" onPress={retry}>
						{t("retry")}
					</Button>
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				{(["html", "txt"] as const).map((format) => (
					<Button
						key={format}
						size="sm"
						className="h-10 flex-1 px-3"
						isDisabled={
							disabled || !selected || Boolean(loading) || Boolean(error)
						}
						isLoading={loading === format}
						startContent={
							<HugeiconsIcon
								icon={Download01Icon}
								className="size-4"
							/>
						}
						onPress={() => {
							if (selected) onDownload(format, selected);
						}}
					>
						{t(
							format === "html"
								? "downloadFormattedCitation"
								: "downloadPlainCitation",
						)}
					</Button>
				))}
			</div>
		</section>
	);
}

function ReferenceManagerDownloads({
	formats,
	loading,
	onDownload,
}: {
	formats: readonly BibliographicExportFormat[];
	loading: boolean;
	onDownload: (format: BibliographicExportFormat) => void;
}) {
	const t = useTranslations("ui");
	if (!formats.length) return null;
	return (
		<section
			className="space-y-2"
			aria-label={t("referenceManagerFormats")}
		>
			<h3 className="text-base font-medium">
				{t("referenceManagerFormats")}
			</h3>
			<Listbox
				aria-label={t("referenceManagerFormats")}
				classNames={{ base: "p-0", list: "gap-1" }}
				disabledKeys={loading ? formats : []}
				onAction={(key) => onDownload(key as BibliographicExportFormat)}
			>
				{formats.map((format) => (
					<ListboxItem
						key={format}
						textValue={format === "ris" ? "RIS" : "BibTeX"}
						className="rounded-xl px-3 py-3"
						classNames={{
							description: "whitespace-normal",
							wrapper: "min-w-0",
						}}
						description={t(
							format === "ris"
								? "RISDescription"
								: "BibTeXDescription",
						)}
						endContent={
							<HugeiconsIcon
								icon={Download01Icon}
								className="size-4 shrink-0 text-default-500"
							/>
						}
					>
						<span className="font-medium">
							{format === "ris" ? "RIS" : "BibTeX"}
						</span>
						<span className="ml-2 text-xs text-default-500">
							.{getLibraryExportExtension(format)}
						</span>
					</ListboxItem>
				))}
			</Listbox>
		</section>
	);
}

async function downloadReferenceFile(
	format: BibliographicExportFormat,
	fileName: string,
	action?: (format: BibliographicExportFormat) => Promise<string>,
	hrefForFormat?: (format: BibliographicExportFormat) => string,
	requestInit?: RequestInit,
) {
	const filename = `${fileName}.${getLibraryExportExtension(format)}`;
	if (hrefForFormat) return downloadFile(hrefForFormat(format), filename, requestInit);
	if (!action) throw new Error("A download action or URL is required");
	const content = await action(format);
	if (!content.trim())
		throw new Error("Citation conversion returned no content");
	requestInit?.signal?.throwIfAborted();
	saveDownload(
		new Blob([content], {
			type:
				format === "ris"
					? "application/x-research-info-systems"
					: "application/x-bibtex",
		}),
		filename,
	);
}

async function downloadFormattedFile(
	format: "txt" | "html",
	fileName: string,
	locale: string,
	path?: string,
	style?: CitationStyle,
	requestInit?: RequestInit,
) {
	if (!path || !style) throw new Error("A citation and style are required");
	const query = new URLSearchParams({ style: style.id, format });
	await downloadFile(`${path}?${query}`, `${fileName}.${format}`, {
		...requestInit,
		headers: { ...requestInit?.headers, "Accept-Language": locale },
	});
}

function downloadErrorCode(error: unknown) {
	if (error instanceof DownloadError && error.code && ["exportTooLarge", "exportChanged", "exportPrivate", "exportNotFound", "exportInvalid"].includes(error.code)) return error.code;
	return "tryAgainLater";
}

function useDownloadAttempt(run: (format: DownloadFormat, style: CitationStyle | undefined, signal: AbortSignal) => Promise<void>, onClose: () => void) {
	const t = useTranslations("ui");
	const [loading, setLoading] = useState<DownloadFormat | null>(null);
	const controller = useRef<AbortController | null>(null);
	// Stop the browser request when the dialog's owner leaves the page.
	useEffect(() => () => controller.current?.abort(), []);
	const close = () => {
		controller.current?.abort();
		onClose();
	};
	async function download(format: DownloadFormat, style?: CitationStyle) {
		if (controller.current) return;
		const attempt = new AbortController();
		controller.current = attempt;
		setLoading(format);
		try {
			await run(format, style, attempt.signal);
			trackContentAction({
				action: "download",
				context: "library_records",
				format,
			});
			onClose();
		} catch (error) {
			if (attempt.signal.aborted) return;
			console.error("Citation download failed", {
				format,
				style: style?.id,
				error,
			});
			toast({
				type: "error",
				title: t("downloadFailed"),
				description: t(downloadErrorCode(error)),
			});
		} finally {
			controller.current = null;
			setLoading(null);
		}
	}
	return { loading, download, close, abort: () => controller.current?.abort() };
}

export function DownloadModal({
	isOpen,
	onOpenChange,
	onClose,
	source,
	description,
	children,
	isDisabled = false,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	source: {
		action?: (format: BibliographicExportFormat) => Promise<string>;
		hrefForFormat?: (format: BibliographicExportFormat) => string;
		fileName: string;
		formats?: readonly BibliographicExportFormat[];
		citationPath?: string;
		requestInit?: RequestInit;
	};
	description?: string;
	children?: (loading: boolean) => ReactNode;
	isDisabled?: boolean;
}) {
	const { action, hrefForFormat, fileName, formats, citationPath, requestInit } = source;
	const t = useTranslations("ui");
	const locale = useLocale();
	const { exports, citations } = useLibraryConfig();
	const availableFormats = formats ?? getEnabledCitationFormats(exports);
	const { loading, download, close, abort } = useDownloadAttempt(async (format, style, signal) => {
		const init = { ...requestInit, signal };
		if (format === "txt" || format === "html") {
			await downloadFormattedFile(format, fileName, locale, citationPath, style, init);
		} else {
			await downloadReferenceFile(format, fileName, action, hrefForFormat, init);
		}
	}, onClose);
	const title = hrefForFormat && !requestInit ? "downloadLibrary" : "download";
	const handleOpenChange = (open: boolean) => {
		if (!open) abort();
		onOpenChange(open);
	};
	const citationDownloads = citations.enabled && citationPath ? (
		<CitationDownloads loading={loading} disabled={isDisabled} onDownload={download} />
	) : null;
	const descriptionContent = description ? <p className="text-sm text-default-500">{description}</p> : null;

	return (
		<DialogModal
			size="md"
			isOpen={isOpen}
			onOpenChange={handleOpenChange}
			onClose={close}
			scrollBehavior="inside"
		>
			<ModalContent>
				<GenericHeader
					startContent={<HugeiconsIcon icon={Download01Icon} />}
					onClose={close}
				>
					{t(title)}
				</GenericHeader>
				<ModalBody className="gap-6 px-6 pb-6 pt-2">
					{children?.(Boolean(loading))}
					{descriptionContent}
					{citationDownloads}
					<ReferenceManagerDownloads
						formats={availableFormats}
						loading={isDisabled || Boolean(loading)}
						onDownload={download}
					/>
				</ModalBody>
			</ModalContent>
		</DialogModal>
	);
}
