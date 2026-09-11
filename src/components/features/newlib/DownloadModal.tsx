"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { PropsWithChildren, useState } from "react";
import { ModalContent, PropsOf, useDisclosure } from "@nextui-org/react";
import GenericHeader from "../modals/GenericHeader";
import { ListModalBody } from "@/components/nextui/ListModalBody";
import DialogModal from "@/components/nextui/DialogModal";
import { Button } from "@/components/nextui/Button";
import { Item } from "@/app/api/item/types";
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

async function defaultAction(
	itemData: Item,
	format: BibliographicExportFormat,
) {
	return await convertItem(itemData!, format);
}

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

	const wrappedDefaultAction = (format: BibliographicExportFormat) => {
		if (!itemData)
			throw new Error("Item data is required for default action");
		return defaultAction(itemData, format);
	};

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
				action={action || wrappedDefaultAction}
				fileName={fileName}
			/>
		</>
	);
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
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	action?: (format: BibliographicExportFormat) => Promise<string>;
	hrefForFormat?: (format: BibliographicExportFormat) => string;
	fileName: string;
	formats?: readonly BibliographicExportFormat[];
	description?: string;
}) {
	const t = useTranslations("ui");
	const [loading, setLoading] = useState(false);
	const { exports } = useLibraryConfig();
	const availableFormats = formats ?? getEnabledCitationFormats(exports);

	return (
		<DialogModal
			size="md"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			onClose={onClose}
		>
			<ModalContent>
				<GenericHeader startContent={<HugeiconsIcon icon={Download01Icon} />} onClose={onClose}>
					{t(hrefForFormat ? "downloadLibrary" : "download")}
				</GenericHeader>
				<ListModalBody
					description={description ?? t("downloadDescription")}
					isLoading={loading}
					onAction={async (index: number) => {
						setLoading(true);
						try {
							const format = availableFormats[index];
							if (!format) return;

							let blob: Blob;
							if (hrefForFormat) {
								const response = await fetch(hrefForFormat(format));
								if (!response.ok) throw new Error(`Download returned ${response.status}`);
								blob = await response.blob();
							} else {
								if (!action) throw new Error("A download action or URL is required");
								const ret = await action(format);
								if (!ret.trim()) throw new Error("Citation conversion returned no content");
								blob = new Blob([ret], { type: format === "ris" ? "application/x-research-info-systems" : "application/x-bibtex" });
							}

							const url = URL.createObjectURL(blob);
							const anchor = document.createElement("a");
							anchor.href = url;
							anchor.download = `${fileName}.${getLibraryExportExtension(format)}`;
							document.body.appendChild(anchor);
							anchor.click();
							anchor.remove();
							URL.revokeObjectURL(url);
							trackContentAction({
								action: "download",
								context: "library_records",
								format,
							});
						} catch (error) {
							console.error(error);
							toast({ type: "error", title: t("downloadFailed"), description: t("tryAgainLater") });
						} finally {
							setLoading(false);
						}
					}}
					highlightedIndexes={[]}
					list={availableFormats.map((format) =>
						format === "ris"
							? {
									name: "RIS",
									subtitle: ".ris",
									description: t("RISDescription"),
								}
							: {
									name: "BibTeX",
									subtitle: ".bib",
									description: t("BibTeXDescription"),
								},
					)}
				/>
			</ModalContent>
		</DialogModal>
	);
}
