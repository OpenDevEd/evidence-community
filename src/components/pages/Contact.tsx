"use client";

import PageContainer from "@/components/layout/PageContainer";
import EmailForm from "@/components/features/form/EmailForm";
import { sendContactRequest } from "@/lib/actions";
import { toast } from "../layout/Toast";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Logo } from "../layout/navbar";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export default function Contact() {
	const t = useTranslations("ui");
	const tFooter = useTranslations("footer");
	const { contact } = useLibraryConfig();
	const hasContact = Boolean(contact.email || contact.phone || contact.address);

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
				}
			/>
		</PageContainer>
	);
}
