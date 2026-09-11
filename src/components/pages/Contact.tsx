"use client";

import { Card } from "@/components/nextui/Card";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Message01Icon } from "@hugeicons/core-free-icons";
import { hasContactDetails } from "@/config/library-config/pages";
import PageContainer from "@/components/layout/PageContainer";
import EmailForm from "@/components/features/form/EmailForm";
import { sendContactRequest } from "@/lib/email-actions";
import { toast } from "../layout/Toast";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Logo } from "../layout/navbar";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export default function Contact({ formEnabled }: { formEnabled: boolean }) {
	const t = useTranslations("ui");
	const tFooter = useTranslations("footer");
	const { contact } = useLibraryConfig();
	const hasContact = hasContactDetails(contact);

	const details = (
		<div className={`w-full max-w-2xl flex flex-col gap-8 items-center ${formEnabled ? "mt-12 border-t border-white/10 pt-8" : "mt-6"}`}>
			{hasContact && (
				<dl className="flex flex-col items-center gap-3 text-center">
					{contact.email && (
						<div>
							<dt className="font-medium">{tFooter("email")}</dt>
							<dd>
								<Link
									className="text-link"
									href={`mailto:${contact.email}`}
								>
									{contact.email}
								</Link>
							</dd>
						</div>
					)}
					{contact.phone && (
						<div>
							<dt className="font-medium">{tFooter("phone")}</dt>
							<dd>
								<Link
									className="text-link"
									href={`tel:${contact.phone}`}
								>
									{contact.phone}
								</Link>
							</dd>
						</div>
					)}
					{contact.address && (
						<div>
							<dt className="font-medium">{tFooter("address")}</dt>
							<dd className="whitespace-pre-line">
								{contact.address}
							</dd>
						</div>
					)}
				</dl>
			)}
			<Logo />
		</div>
	);

	return (
		<PageContainer>
			{formEnabled ? <EmailForm
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
				footer={details}
			/> : (
				<Card color="card" className="w-full p-8 md:p-16 flex items-center justify-center">
					<HugeiconsIcon icon={Message01Icon} className="size-12 text-accent mb-2" />
					<h1 className="text-3xl font-bold text-center">{t("contactUs")}</h1>
					{details}
				</Card>
			)}
		</PageContainer>
	);
}
