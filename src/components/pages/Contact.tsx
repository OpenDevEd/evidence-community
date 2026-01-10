"use client";

import PageContainer from "@/components/layout/PageContainer";
import EmailForm from "@/components/features/form/EmailForm";
import { sendContactRequest } from "@/lib/actions";
import { toast } from "../layout/Toast";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Logo } from "../layout/navbar";
import { Spacer } from "@nextui-org/react";

export default function Contact() {
	const t = useTranslations("ui");

	const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

	return (
		<PageContainer>
			<EmailForm
				fields={["email", "description"]}
				header={t("contactUs")}
				subtitle={t("fillFormBelow")}
				onSubmit={async (value, reset) => {
					const result = await sendContactRequest(
						value.email,
						value.description
					);
					if (result.success) {
						reset();
						toast({
							title: t("emailSent"),
							description: t("emailSentDesc"),
							type: "success",
						});
					} else {
						toast({
							title: t("emailNotSent"),
							description: t("tryAgainLater"),
							type: "error",
						});
					}
				}}
				footer={
					<div className="mt-12 w-full max-w-2xl border-t border-white/10 pt-8 flex flex-col gap-8 items-center">
						{contactEmail && (
							<p className="text-center">
								{t("contactViaEmail")}{" "}
								<Link
									className="text-link_light dark:text-link"
									href={`mailto:${contactEmail}`}
								>
									{contactEmail}
								</Link>
								.
							</p>
						)}
						<Logo />
					</div>
				}
			/>
		</PageContainer>
	);
}
