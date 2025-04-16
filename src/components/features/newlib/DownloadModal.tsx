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

async function defaultAction(itemData: Item, format: "ris" | "bibtex") {
	return await convertItem(itemData!, format);
}

export function DownloadButton({
	action,
	fileName,
	itemData,
	...props
}: PropsOf<typeof Button> & {
	action?: (format: "ris" | "bibtex") => Promise<string>;
	fileName: string;
	itemData?: Item;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const t = useTranslations("ui");

	const wrappedDefaultAction = (format: "ris" | "bibtex") => {
		if (!itemData) throw new Error("Item data is required for default action");
		return defaultAction(itemData, format);
	};
	
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
	fileName,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	action: (format: "ris" | "bibtex") => Promise<string>;
	fileName: string;
}) {
	const t = useTranslations("ui");
	const [loading, setLoading] = useState(false);

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
							const format = ["ris", "bibtex"][index] as
								| "ris"
								| "bibtex";
							const ret = await action(format);
							const blob = new Blob([ret], {
								type:
									format === "ris"
										? "application/x-research-info-systems"
										: "application/x-bibtex",
							});
							const url = URL.createObjectURL(blob);
							const a = document.createElement("a");
							a.href = url;
							a.download = `${fileName}.${
								format === "ris" ? "ris" : "bib"
							}`;
							a.click();
						} catch (error) {
							console.error(error);
						} finally {
							setLoading(false);
						}
					}}
					highlightedIndexes={[]}
					list={[
						{
							name: "RIS",
							subtitle: ".ris",
							description: t("RISDescription"),
						},
						{
							name: "BibTeX",
							subtitle: ".bib",
							description: t("BibTeXDescription"),
						},
					]}
				/>
			</ModalContent>
		</DialogModal>
	);
}