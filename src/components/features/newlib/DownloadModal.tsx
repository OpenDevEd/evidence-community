"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
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
import { downloadFile, saveDownload } from "@/lib/download";
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
				fileName={fileName}
				citationPath={
					itemData?.key
						? `/api/item/${encodeURIComponent(itemData.key)}/export/citation`
						: undefined
				}
				action={
					action ??
					(async (format) => {
						if (!itemData)
							throw new Error(
								"Item data is required for download",
							);
						return convertItem(itemData, format);
					})
				}
			/>
		</>
	);
}

function CitationDownloads({
	loading,
	onDownload,
}: {
	loading: DownloadFormat | null;
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
				isDisabled={Boolean(loading)}
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
							!selected || Boolean(loading) || Boolean(error)
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
) {
	const filename = `${fileName}.${getLibraryExportExtension(format)}`;
	if (hrefForFormat) return downloadFile(hrefForFormat(format), filename);
	if (!action) throw new Error("A download action or URL is required");
	const content = await action(format);
	if (!content.trim())
		throw new Error("Citation conversion returned no content");
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
) {
	if (!path || !style) throw new Error("A citation and style are required");
	const query = new URLSearchParams({ style: style.id, format });
	await downloadFile(`${path}?${query}`, `${fileName}.${format}`, {
		headers: { "Accept-Language": locale },
	});
}

export function DownloadModal({
	isOpen,
	onOpenChange,
	onClose,
	action,
	hrefForFormat,
	fileName,
	formats,
	description,
	citationPath,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	action?: (format: BibliographicExportFormat) => Promise<string>;
	hrefForFormat?: (format: BibliographicExportFormat) => string;
	fileName: string;
	formats?: readonly BibliographicExportFormat[];
	description?: string;
	citationPath?: string;
}) {
	const t = useTranslations("ui");
	const locale = useLocale();
	const [loading, setLoading] = useState<DownloadFormat | null>(null);
	const { exports, citations } = useLibraryConfig();
	const availableFormats = formats ?? getEnabledCitationFormats(exports);

	async function download(format: DownloadFormat, style?: CitationStyle) {
		setLoading(format);
		try {
			if (format === "txt" || format === "html") {
				await downloadFormattedFile(
					format,
					fileName,
					locale,
					citationPath,
					style,
				);
			} else {
				await downloadReferenceFile(
					format,
					fileName,
					action,
					hrefForFormat,
				);
			}
			trackContentAction({
				action: "download",
				context: "library_records",
				format,
			});
			onClose();
		} catch (error) {
			console.error("Citation download failed", {
				format,
				style: style?.id,
				error,
			});
			toast({
				type: "error",
				title: t("downloadFailed"),
				description: t("tryAgainLater"),
			});
		} finally {
			setLoading(null);
		}
	}

	return (
		<DialogModal
			size="md"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			onClose={onClose}
			scrollBehavior="inside"
		>
			<ModalContent>
				<GenericHeader
					startContent={<HugeiconsIcon icon={Download01Icon} />}
					onClose={onClose}
				>
					{t(hrefForFormat ? "downloadLibrary" : "download")}
				</GenericHeader>
				<ModalBody className="gap-6 px-6 pb-6 pt-2">
					{description && (
						<p className="text-sm text-default-500">
							{description}
						</p>
					)}
					{citations.enabled && citationPath && (
						<CitationDownloads
							loading={loading}
							onDownload={download}
						/>
					)}
					<ReferenceManagerDownloads
						formats={availableFormats}
						loading={Boolean(loading)}
						onDownload={download}
					/>
				</ModalBody>
			</ModalContent>
		</DialogModal>
	);
}
