"use client";

import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useFormatter, useTranslations } from "next-intl";
import PageContainer from "./PageContainer";

export default function NotFound() {
	const t = useTranslations("ui");
	const format = useFormatter();

	return (
		<PageContainer id="main-content" className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center text-black/80 dark:text-white/80">
			<div aria-hidden="true" className="text-8xl font-bold leading-none tabular-nums sm:text-9xl">
				{format.number(404)}
			</div>
			<h1 className="text-2xl font-medium leading-snug sm:text-3xl">{t("pageNotFound")}</h1>
			<Button as={Link} role="link" href="/lib" size="md" startContent={<HugeiconsIcon icon={Search01Icon} className="size-4" />}>
				{t("search")}
			</Button>
		</PageContainer>
	);
}
