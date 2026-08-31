"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { DropdownMenu } from "@nextui-org/react";
import { siZotero } from "simple-icons";
import { DropdownItem } from "@nextui-org/react";

import BrandIcon from "@/components/icons/BrandIcon";
import { Dropdown } from "@/components/nextui/Dropdown";
import { DropdownTrigger } from "@nextui-org/react";
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
					startContent={<BrandIcon icon={siZotero} className="size-4" aria-hidden />}
					endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />}
				>
				</Button>
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction}>
				<DropdownItem key="view" startContent={<BrandIcon icon={siZotero} className="size-4" aria-hidden />} href="#">
					{t("viewOnZotero")}
				</DropdownItem>
				<DropdownItem key="open" startContent={<BrandIcon icon={siZotero} className="size-4" aria-hidden />} href="#">
					{t("openInZotero")}
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}
