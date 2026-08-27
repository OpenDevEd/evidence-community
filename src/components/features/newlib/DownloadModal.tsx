"use client";

import {
	LuDownload
} from "react-icons/lu";
import { useTranslations } from "next-intl";
import { PropsWithChildren, useState } from "react";
import {
	ModalContent,
	PropsOf,
	useDisclosure
} from "@nextui-org/react";
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
		if (!itemData) throw new Error("Item data is required for default action");
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
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	action?: (format: BibliographicExportFormat) => Promise<string>;
	hrefForFormat?: (format: BibliographicExportFormat) => string;
	fileName: string;
	formats?: readonly BibliographicExportFormat[];
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
				<GenericHeader startContent={<LuDownload />} onClose={onClose}>
					{t("download")}
				</GenericHeader>
				<ListModalBody
					description={t("downloadDescription")}
					isLoading={loading}
					onAction={async (index: number) => {
						setLoading(true);
						try {
							const format = availableFormats[index];
							if (!format) return;

							if (hrefForFormat) {
								const anchor = document.createElement("a");
								anchor.href = hrefForFormat(format);
								anchor.download = `${fileName}.${getLibraryExportExtension(format)}`;
								document.body.appendChild(anchor);
								anchor.click();
								anchor.remove();
								return;
							}

							if (!action) {
								throw new Error(
									"A download action or URL is required",
								);
							}

							const ret = await action(format);
							const blob = new Blob([ret], {
								type:
									format === "ris"
										? "application/x-research-info-systems"
										: "application/x-bibtex",
							});
							const url = URL.createObjectURL(blob);
							const anchor = document.createElement("a");
							anchor.href = url;
							anchor.download = `${fileName}.${getLibraryExportExtension(format)}`;
							document.body.appendChild(anchor);
							anchor.click();
							anchor.remove();
							URL.revokeObjectURL(url);
						} catch (error) {
							console.error(error);
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
