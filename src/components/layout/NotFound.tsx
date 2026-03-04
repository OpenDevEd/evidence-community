import { Link } from "@/i18n/routing";
import { Button } from "@heroui/react";
import { useFormatter, useTranslations } from "next-intl";

export default function NotFound() {
	const t = useTranslations("ui");
	const format = useFormatter();

	return (
		<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium lg:min-h-[calc(100vh-104px-(56px*2))] min-h-[calc(100vh-88px-(32px*2))] flex flex-col items-center justify-center gap-4">
			<div className="text-[15vw] font-bold leading-[15vw]">
				{format.number(404)}
			</div>
			<div className="text-[1.5vw] leading-[1.5vw] font-medium">{t("pageNotFound")}</div>
		</div>
	);
}

