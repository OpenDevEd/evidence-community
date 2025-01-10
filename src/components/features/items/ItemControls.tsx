"use client";

import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import CopyButton from "./CopyButton";
import { Item } from "@/app/api/item/types";
import { useMemo, useRef } from "react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { DropdownItem } from "@nextui-org/dropdown";
import { DropdownMenu } from "@nextui-org/dropdown";
import { DropdownTrigger } from "@nextui-org/react";
import { BsThreeDots } from "react-icons/bs";
import { FaClipboard } from "react-icons/fa";
import LikeButton from "./LikeButton";

type Interaction = "readDocument" | "downloadRecord" | "printRecord" | "copyLink" | "preferences" | "like";

type ButtonConfig = {
	key: Interaction;
	Component: typeof Button | typeof CopyButton | typeof LikeButton;
	label: string;
	props: Record<string, any>;
	hideFromDropdown?: boolean;
	hideLabel?: boolean;
};

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
	});

	const buttonConfigs: ButtonConfig[] = useMemo(() => [
		// {
			// 				key: "readDocument",
// 				Component: Button,
// 				label: t("readDocument"),
// 				props: {
// 						size: "sm",
// 						className: "ml-auto rtl:ml-0 rtl:mr-auto hidden xl:flex",
// 						startContent: <TiDocumentText className="size-5" />
			// 	}
			// 		},
		{
			key: "downloadRecord",
			Component: Button,
			label: t("downloadRecord"),
			props: {
				size: "sm",
				className: "hidden xl:flex",
				startContent: <LuDownload className="size-5" />
			}
		},
		{
			key: "printRecord",
			Component: Button,
			label: t("printRecord"),
			props: {
				size: "sm",
				className: "hidden xl:flex",
				startContent: <LuPrinter className="size-5" />
			}
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
				startContent: <FaClipboard className="size-5" />
			}
		},
		{
			key: "like",
			Component: LikeButton,
			label: t("like"),
			hideFromDropdown: true,
			props: {
				itemData: itemData,
			}
		},
		{
			key: "preferences",
			Component: Button,
			label: t("preferences"),
			hideLabel: true,
			props: {
				size: "sm",
				className: "rounded-full hidden xl:flex",
				isIconOnly: true,
				startContent: <PiSlidersHorizontalBold className="size-5" />
			}
		}
	], [itemData, router]);

	return (
		<div className="flex justify-start gap-4 w-full bg-black/[4%] dark:bg-secondary p-4 rounded-t-2xl">
			<Button
				size="sm"
				startContent={
					<LuChevronLeft className="size-5 rtl:rotate-180" />
				}
				className="ltr:pl-1.5 rtl:pr-1.5"
				onClick={() => router.back()}
			>
				{t("return")}
			</Button>
			{buttonConfigs.map(({ key, Component, label, props, hideLabel }: any) => (
				<Component
					key={key}
					ref={(el: HTMLButtonElement | null) => {
						controlsRef.current[key as Interaction] = el;
					}}
					{...props}
				>
					{!hideLabel && label}
				</Component>
			))}
			<Dropdown>
				<DropdownTrigger>
					<Button className="ltr:ml-auto rtl:mr-auto flex xl:hidden" size="sm" isIconOnly startContent={<BsThreeDots className="size-5" />}>
					</Button>
				</DropdownTrigger>
				<DropdownMenu onAction={(key) => {
					controlsRef.current[key as Interaction]?.click();
				}}>
					{buttonConfigs.filter(({ hideFromDropdown }) => !hideFromDropdown).map(({ key, label, props }) => (
						<DropdownItem key={key} startContent={props.startContent}>
							{label}
						</DropdownItem>
					))}
				</DropdownMenu>
			</Dropdown>
		</div>
	);
}
