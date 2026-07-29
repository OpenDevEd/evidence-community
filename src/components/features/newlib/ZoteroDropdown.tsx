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



export default function ZoteroDropdown({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	if (
		!item ||
		item.provider !== "zotero" ||
		!item.sourceExternalScopeKey
	) return null;

	const handleAction = (key: Key) => {
		if (key === "view") {
			window.open(`https://zotero.org/users/local/zotero/items/${item.sourceRecordKey}`, "_blank");
		} else if (key === "open") {
			window.open(`zotero://select/groups/${item.sourceExternalScopeKey}/items/${item.sourceRecordKey}`, "_blank");
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
