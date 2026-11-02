"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link02Icon } from "@hugeicons/core-free-icons";
import PageContainer from "@/components/layout/PageContainer";
import EmailForm from "@/components/features/form/EmailForm";
import { useTranslations } from "next-intl";
import { sendTakedownRequest } from "@/lib/email-actions";
import { toast } from "../layout/Toast";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Link } from "@/i18n/routing";
import { parseRequestLinks } from "@/lib/utils";

function Footer() {
	const tLabels = useTranslations("takedown");
	const t = useTranslations("ui");
	const { legal } = useLibraryConfig();

	return (<div className="mt-12 w-full max-w-2xl border-t border-white/10 pt-8">
		<div className="space-y-4 text-sm">
			<h2 className="text-lg font-semibold">
				{tLabels("aboutTakedownRequests")}
			</h2>
			<p className="opacity-80">
				{t("takedownRequestsExplanation")}
			</p>
			<p className="opacity-80">{t("whenToSubmitTakedown")}</p>
			<div className="flex items-center gap-2 text-accent">
				<Link
					href={legal.privacyPolicy}
					className="inline-flex items-center gap-2 hover:underline"
				>
					{t("learnMorePolicies")}
					<HugeiconsIcon icon={Link02Icon} className="text-lg" />
				</Link>
			</div>
		</div>
	</div>)
}

export default function Takedown() {
	const t = useTranslations("ui");

	return (
		<PageContainer id="main-content" className="flex gap-4 items-start">
			<EmailForm fields={["email", "links", "description"]} footer={<Footer/>} onSubmit={async (value, reset) => {
				const result = await sendTakedownRequest(
					value.email,
					parseRequestLinks(value.links),
					value.description
				);
				if (result.success) {
					reset();
					toast({
						title: t("requestSent"),
						description: t("requestSentDesc"),
						type: "success",
					});
				} else {
					toast({
						title: t("requestFailed"),
						description: t("tryAgainLater"),
						type: "error",
					});
				}
			}} />
		</PageContainer>
	);
}
