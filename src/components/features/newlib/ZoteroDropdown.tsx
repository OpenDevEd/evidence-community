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



export default function ZoteroDropdown({ item }: { item: Item | undefined }) {
	if (!item || item.groupExternalId === 1) return null;

	const handleAction = (key: Key) => {
		if (key === "view") {
			window.open(`https://zotero.org/users/local/zotero/items/${item.key}`, "_blank");
		} else if (key === "open") {
			window.open(`zotero://select/groups/${item.groupExternalId}/items/${item.key}`, "_blank");
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
					View on Zotero.org
				</DropdownItem>
				<DropdownItem key="open" startContent={<SiZotero />} href="#">
					Open in Zotero
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}
