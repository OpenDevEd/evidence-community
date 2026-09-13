"use client";

import { useTranslations } from "next-intl";
import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";

export default function PolicyEmailCopyButton({ email }: { email: string }) {
	const t = useTranslations("policy");
	return (
		<CopyButton textToCopy={email} ariaLabel={t("copyEmail")}>
			<Button
				isIconOnly
				variant="transparent"
				size="xs"
				title={t("copyEmail")}
				className="shrink-0 self-center print:hidden"
			/>
		</CopyButton>
	);
}
