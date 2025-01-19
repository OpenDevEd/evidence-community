"use client";

import { LuChevronLeft, LuDownload, LuExternalLink, LuPrinter } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import CopyButton from "./CopyButton";
import { Item } from "@/app/api/item/types";
import React, { PropsWithChildren, useMemo, useRef, useState } from "react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { DropdownItem } from "@nextui-org/dropdown";
import { DropdownMenu } from "@nextui-org/dropdown";
import {
	ButtonProps,
	DropdownTrigger,
	ModalBody,
	ModalContent,
	useDisclosure,
} from "@nextui-org/react";
import { BsThreeDots } from "react-icons/bs";
import { FaClipboard } from "react-icons/fa";
import LikeButton from "./LikeButton";
import AIModal from "@/components/nextui/AIModal";
import GenericHeader from "../modals/GenericHeader";
import { ListModalBody } from "@/components/nextui/ListModalBody";
import { convertItem } from "@/lib/actions";
import { Switch } from "@/components/nextui/Switch";
import { useLocalStorage } from "usehooks-ts";
import { SiZotero } from "react-icons/si";

type Interaction =
	| "readDocument"
	| "downloadRecord"
	| "printRecord"
	| "copyLink"
	| "preferences"
	| "like"
	| "openInZotero"
	| "viewOnZotero";

type ButtonConfig = {
	key: Interaction;
	Component:
		| typeof Button
		| typeof CopyButton
		| typeof LikeButton
		| typeof DownloadButton
		| typeof PreferencesButton;
	label: string;
	props: Record<string, any>;
	hideFromDropdown?: boolean;
	hideLabel?: boolean;
};

const CONFIG_LABELS: {
	key: string;
}[] = [
	{
		key: "openInZotero",
	},
	{
		key: "viewOnZotero",
	},
];

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
		<AIModal
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
		</AIModal>
	);
}

export function DownloadButton({
	action,
	fileName,
	...props
}: PropsWithChildren<typeof Button> & {
	action: (format: "ris" | "bibtex") => Promise<string>;
	fileName: string;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const t = useTranslations("ui");

	return (
		<>
			<Button {...props} onPress={onOpen}>
				{props.children}
			</Button>
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				action={action}
				fileName={fileName}
			/>
		</>
	);
}

function PreferenceSwitch({
	configKey,
	config,
	name,
	setConfig,
}: {
	configKey: string;
	name: string;
	config: Record<string, boolean>;
	setConfig: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
	return (
		<Switch
			isSelected={config[configKey]}
			onValueChange={(value) => {
				setConfig((prev) => ({ ...prev, [configKey]: value }));
			}}
		>
			{name}
		</Switch>
	);
}

function PreferencesModal({
	isOpen,
	onOpenChange,
	onClose,
	config,
	setConfig,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
	config: Record<string, boolean>;
	setConfig: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
	const t = useTranslations("ui");

	return (
		<AIModal
			size="md"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			onClose={onClose}
		>
			<ModalContent>
				<GenericHeader
					startContent={
						<PiSlidersHorizontalBold className="size-5" />
					}
					onClose={onClose}
				>
					{t("preferences")}
				</GenericHeader>
				<ModalBody className="p-6 pt-0 space-y-3">
					{CONFIG_LABELS.map((configLabel: any, index: number) => (
						<div key={index} className="flex flex-col gap-2">
							<div
								key={configLabel.key}
								className="flex flex-col gap-2"
							>
								<PreferenceSwitch
									configKey={configLabel.key}
									name={t(`${configLabel.key}ToggleLabel`)}
									config={config}
									setConfig={setConfig}
								/>
								<p className="text-sm text-black/80 dark:text-white/80">
									{t(`${configLabel.key}ToggleDescription`)}
								</p>
							</div>
						</div>
					))}
				</ModalBody>
			</ModalContent>
		</AIModal>
	);
}

function PreferencesButton({
	config,
	setConfig,
	children,
	...props
}: PropsWithChildren<typeof Button> & {
	config: Record<string, boolean>;
	setConfig: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	return (
		<>
			<Button
				{...props}
				onPress={() => {
					onOpen();
				}}
			>
				{children}
			</Button>
			<PreferencesModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				config={config}
				setConfig={setConfig}
			/>
		</>
	);
}

export default function ItemControls({
	itemData,
	router,
}: {
	itemData: Item | undefined;
	router: ReturnType<typeof useRouter>;
}) {
	const t = useTranslations("ui");
	const controlsRef = useRef<Record<Interaction, HTMLButtonElement | null>>({
		readDocument: null,
		downloadRecord: null,
		printRecord: null,
		copyLink: null,
		preferences: null,
		like: null,
		openInZotero: null,
		viewOnZotero: null,
	});

	const [config, setConfig] = useLocalStorage(
		"item-controls",
		CONFIG_LABELS.reduce((acc, label) => {
			acc[label.key] = false;
			return acc;
		}, {} as Record<string, boolean>)
	);

	const buttonConfigs: ButtonConfig[] = useMemo(
		() => [
			{
				key: "openInZotero",
				Component: Button,
				label: t("openInZotero"),
				props: {
					size: "sm",
					className: "hidden xl:flex",
					startContent: <SiZotero className="size-3" />,
					onPress: () => {
						window.open(
							`zotero://select/groups/${itemData?.groupExternalId}/items/${itemData?.key}`,
							"_blank"
						);
					},
				},
			},
			{
				key: "viewOnZotero",
				Component: Button,
				label: t("viewOnZotero"),
				props: {
					size: "sm",
					className: "hidden xl:flex",
					startContent: <SiZotero className="size-3" />,
					onPress: () => {
						window.open(
							`https://www.zotero.org/groups/${itemData?.groupExternalId}/items/${itemData?.key}`,
							"_blank"
						);
					},
				},
			},
			{
				key: "downloadRecord",
				Component: DownloadButton,
				label: t("downloadRecord"),
				props: {
					action: async (format: "ris" | "bibtex") => {
						return await convertItem(itemData!, format);
					},
					fileName: itemData!.key,
					size: "sm",
					className: "hidden xl:flex ml-auto rtl:ml-0 rtl:mr-auto",
					startContent: <LuDownload className="size-5" />,
				},
			},
			{
				key: "printRecord",
				Component: Button,
				label: t("printRecord"),
				props: {
					size: "sm",
					className: "hidden xl:flex",
					startContent: <LuPrinter className="size-5" />,
				},
			},
			{
				key: "copyLink",
				Component: CopyButton,
				label: t("copyLink"),
				props: {
					className: "hidden xl:flex",
					itemData: itemData,
					text: t("copyLink"),
					textOnCopy: t("linkCopied"),
					startContent: <FaClipboard className="size-5" />,
				},
			},
			{
				key: "like",
				Component: LikeButton,
				label: t("like"),
				hideFromDropdown: true,
				props: {
					itemData: itemData,
				},
			},
			{
				key: "preferences",
				Component: PreferencesButton,
				label: t("preferences"),
				hideLabel: true,
				props: {
					size: "sm",
					className: "rounded-full hidden xl:flex",
					isIconOnly: true,
					startContent: (
						<PiSlidersHorizontalBold className="size-5" />
					),
					config,
					setConfig,
				},
			},
		],
		[itemData, router, config, setConfig]
	);

	return (
		<div className="flex justify-start gap-4 w-full bg-black/[4%] dark:bg-secondary p-4 rounded-t-2xl">
			<Button
				size="sm"
				startContent={
					<LuChevronLeft className="size-5 rtl:rotate-180" />
				}
				className="ltr:pl-1.5 rtl:pr-1.5"
				onPress={() => {
					if (window.history.length > 1) {
						router.back();
					} else {
						router.push("/lib");
					}
				}}
			>
				{t("return")}
			</Button>
			{buttonConfigs
				.filter(
					({ key }) => config[key] !== false
				)
				.map(
					({ key, Component, label, props, hideLabel }: any) => (
						<Component
							key={key}
						ref={(el: HTMLButtonElement | null) => {
							controlsRef.current[key as Interaction] = el;
						}}
						{...props}
					>
						{!hideLabel && label}
					</Component>
				)
			)}
			<Dropdown>
				<DropdownTrigger>
					<Button
						className="ltr:ml-auto rtl:mr-auto flex xl:hidden"
						size="sm"
						isIconOnly
						startContent={<BsThreeDots className="size-5" />}
					></Button>
				</DropdownTrigger>
				<DropdownMenu
					onAction={(key) => {
						controlsRef.current[key as Interaction]?.click();
					}}
				>
					{buttonConfigs
						.filter(
							({ hideFromDropdown, key }) =>
								!hideFromDropdown && config[key] !== false
						)
						.map(({ key, label, props }) => (
							<DropdownItem
								key={key}
								startContent={props.startContent}
							>
								{label}
							</DropdownItem>
						))}
				</DropdownMenu>
			</Dropdown>
		</div>
	);
}
