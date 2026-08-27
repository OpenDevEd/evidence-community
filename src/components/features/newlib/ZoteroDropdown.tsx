"use client";

import { Button } from "@/components/nextui/Button";
import { DropdownMenu } from "@nextui-org/react";
import { SiZotero } from "react-icons/si";
import { DropdownItem } from "@nextui-org/react";

import { Dropdown } from "@/components/nextui/Dropdown";
import { DropdownTrigger } from "@nextui-org/react";
import { BiChevronDown } from "react-icons/bi";
import { Key } from "react";
import { Item } from "@/app/api/item/types";
import { useTranslations } from "next-intl";
import { getZoteroGroupItemLinks } from "@/lib/zoteroLinks";

export default function ZoteroDropdown({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const links = getZoteroGroupItemLinks(item);
	if (!links) return null;

	const handleAction = (key: Key) => {
		if (key === "view") {
			window.open(links.web, "_blank");
		} else if (key === "open") {
			window.open(links.desktop, "_blank");
		}
	};

	return (
		<Dropdown>
			<DropdownTrigger>
				<Button
					size="sm"
					startContent={<SiZotero />}
					endContent={<BiChevronDown className="size-4" />}
				>
				</Button>
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction}>
				<DropdownItem key="view" startContent={<SiZotero />} href="#">
					{t("viewOnZotero")}
				</DropdownItem>
				<DropdownItem key="open" startContent={<SiZotero />} href="#">
					{t("openInZotero")}
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}
