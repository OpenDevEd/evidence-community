"use client";

import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";

export default function ItemControls() {
	const t = useTranslations("ui");
	const router = useRouter();

	return (
		<div className="flex justify-start gap-6 w-full">
			<Button
				startContent={<LuChevronLeft className="size-5" />}
				onClick={() => router.back()}
			>
				{t("return")}
			</Button>
			<Button
				className="ml-auto"
				startContent={<TiDocumentText className="size-5" />}
			>
				{t("readDocument")}
			</Button>
			<Button startContent={<LuDownload className="size-5" />}>
				{t("downloadRecord")}
			</Button>
			<Button startContent={<LuPrinter className="size-5" />}>
				{t("printRecord")}
			</Button>
			<Button
				startContent={<PiSlidersHorizontalBold className="size-5" />}
			>
				{t("preferences")}
			</Button>
		</div>
	);
}