"use client";

import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import CopyButton from "./CopyButton";
import { Item } from "@/app/api/item/types";

export default function ItemControls({
	itemData,
	router,
}: {
	itemData: Item | undefined;
	router: ReturnType<typeof useRouter>;
}) {
	const t = useTranslations("ui");

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
			<Button
				size="sm"
				className="ml-auto rtl:ml-0 rtl:mr-auto"
				startContent={<TiDocumentText className="size-5" />}
			>
				{t("readDocument")}
			</Button>
			<Button size="sm" startContent={<LuDownload className="size-5" />}>
				{t("downloadRecord")}
			</Button>
			<Button size="sm" startContent={<LuPrinter className="size-5" />}>
				{t("printRecord")}
			</Button>
			<CopyButton itemData={itemData} />
			<Button
				size="sm"
				className="rounded-full"
				isIconOnly
				startContent={<PiSlidersHorizontalBold className="size-5" />}
			></Button>
		</div>
	);
}
