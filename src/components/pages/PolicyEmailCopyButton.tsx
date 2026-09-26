"use client";

import { useTranslations } from "next-intl";
import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";

export default function PolicyEmailCopyButton({ email }: { email: string }) {
	const t = useTranslations("policy");
	return (
		<Tooltip content={t("copyEmail")}>
			<span className="inline-flex shrink-0 self-center print:hidden">
				<CopyButton textToCopy={email} ariaLabel={t("copyEmail")}>
					<Button isIconOnly variant="transparent" size="xs" />
				</CopyButton>
			</span>
		</Tooltip>
	);
}
