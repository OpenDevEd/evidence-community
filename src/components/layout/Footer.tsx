"use client";

import { Linkedin01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { siBluesky, siGithub, siX, siYoutube, type SimpleIcon } from "simple-icons";

import { AnalyticsConsentDialogContent } from "@/components/features/analytics/AnalyticsConsentDialogContent";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import BrandIcon from "@/components/icons/BrandIcon";
import {
	FunderLogo,
	FundingPartners,
	LibraryLogo,
	useLibraryLogo,
} from "@/components/library/LibraryIdentity";
import DialogModal from "@/components/nextui/DialogModal";
import { Skeleton } from "@/components/nextui/Skeleton";
import {
	getRuntimeLinkAnchorProps,
	getVisibleRuntimeLinks,
	type RuntimeLeafLink,
} from "@/config/library-config/links";
import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Link, useRouter } from "@/i18n/routing";
import { isPolicyPage } from "@/lib/legal-links";
import { localizeOrUseIfCapitalized } from "@/lib/utils";

type SocialProvider =
	LibraryPublicConfig["footer"]["socialLinks"][number]["provider"];

const SOCIAL_BRANDS = {
	github: siGithub,
	twitter: siX,
	linkedin: null,
	youtube: siYoutube,
	bluesky: siBluesky,
} satisfies Record<SocialProvider, SimpleIcon | null>;

const SOCIAL_COLORS = {
	github: "bg-black dark:bg-white text-white dark:text-black",
	twitter: "bg-sky-500 text-white",
	linkedin: "bg-sky-700 text-white",
	youtube: "bg-red-600 text-white",
	bluesky: "bg-sky-600 text-white",
} satisfies Record<SocialProvider, string>;

function FooterColumn({
	children,
	title,
}: {
	children: React.ReactNode;
	title: string;
}) {
	return (
		<section className="flex min-w-0 flex-col items-center gap-5 sm:items-start">
			<h2 className="text-xl font-bold text-black/80 dark:text-white/80">
				{title}
			</h2>
			{children}
		</section>
	);
}

function FooterLink({ link }: { link: RuntimeLeafLink }) {
	const tNav = useTranslations("nav");

	return (
		<Link
			href={link.href}
			{...getRuntimeLinkAnchorProps(link)}
			className="text-lg text-black/60 hover:text-accent dark:text-white/60 dark:hover:text-accent"
		>
			{localizeOrUseIfCapitalized(link.label, tNav)}
		</Link>
	);
}

function Logo() {
	const { isLoaded, onLogoSettled } = useLibraryLogo();

	return (
		<Skeleton
			isLoaded={isLoaded}
			className="flex h-12 w-logo-footer items-center justify-center rounded-lg"
		>
			<LibraryLogo onSettled={onLogoSettled} place="footer" />
		</Skeleton>
	);
}

export default function Footer() {
	const t = useTranslations("footer");
	const tUI = useTranslations("ui");
	const { contact, footer, legal } = useLibraryConfig();
	const { capabilities, openPreferences } = useAnalyticsConsent();
	const pathname = usePathname();
	const router = useRouter();
	const isMapPage = pathname.includes("/map");
	const onPolicyPage = isPolicyPage(pathname);
	const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
	const hasContact = Boolean(
		contact.email || contact.phone || contact.address,
	);

	if (isMapPage) return null;

	return (
		<footer
			id="footer"
			className="relative row-start-3 flex w-full flex-col items-center gap-12 bg-card_light px-6 py-12 print:hidden dark:bg-card lg:px-14"
		>
			<div className="grid w-full max-w-site grid-cols-1 gap-10 sm:grid-cols-2 xl:grid-cols-4">
				<section className="flex flex-col items-center gap-6 sm:items-start">
					<Logo />
					<FundingPartners className="justify-center text-black/60 dark:text-white/60 sm:justify-start" />
					{hasContact && (
						<dl className="flex flex-col gap-3 text-center text-black/60 dark:text-white/60 sm:text-left">
							{contact.email && (
								<div>
									<dt className="font-medium">
										{t("email")}
									</dt>
									<dd>
										<a
											className="break-all font-bold hover:text-accent"
											href={`mailto:${contact.email}`}
										>
											{contact.email}
										</a>
									</dd>
								</div>
							)}
							{contact.phone && (
								<div>
									<dt className="font-medium">
										{t("phone")}
									</dt>
									<dd>
										<a
											className="font-bold hover:text-accent"
											href={`tel:${contact.phone}`}
										>
											{contact.phone}
										</a>
									</dd>
								</div>
							)}
							{contact.address && (
								<div>
									<dt className="font-medium">
										{t("address")}
									</dt>
									<dd className="whitespace-pre-line font-bold">
										{contact.address}
									</dd>
								</div>
							)}
						</dl>
					)}
				</section>

				{footer.sections.map((section) => {
					const links = getVisibleRuntimeLinks(section.links);
					if (links.length === 0) return null;

					return (
						<FooterColumn
							key={section.id}
							title={localizeOrUseIfCapitalized(section.title, t)}
						>
							<ul className="flex flex-col items-center gap-3 sm:items-start">
								{links.map((link) => (
									<li key={link.id}>
										<FooterLink link={link} />
									</li>
								))}
							</ul>
						</FooterColumn>
					);
				})}

				<FooterColumn title={t("legal")}>
					<ul className="flex flex-col items-center gap-3 sm:items-start">
						<li>
							<Link
								href={legal.privacyPolicy}
								className="text-lg text-black/60 hover:text-accent dark:text-white/60 dark:hover:text-accent"
							>
								{t("privacyPolicy")}
							</Link>
						</li>
						<li>
							<Link
								href={legal.cookiePolicy}
								className="text-lg text-black/60 hover:text-accent dark:text-white/60 dark:hover:text-accent"
							>
								{t("cookiePolicy")}
							</Link>
						</li>
						{legal.termsOfService && (
							<li>
								<Link
									href={legal.termsOfService}
									className="text-lg text-black/60 hover:text-accent dark:text-white/60 dark:hover:text-accent"
								>
									{t("termsOfService")}
								</Link>
							</li>
						)}
						{capabilities.analytics && (
							<li>
								<button
									type="button"
									onClick={
										onPolicyPage
											? () => setPolicyDialogOpen(true)
											: openPreferences
									}
									className="text-left text-lg text-black/60 hover:text-accent dark:text-white/60 dark:hover:text-accent"
								>
									{tUI("cookieSettings")}
								</button>
							</li>
						)}
					</ul>
				</FooterColumn>

				{footer.socialLinks.length > 0 && (
					<FooterColumn title={t("stayConnected")}>
						<ul className="flex flex-wrap gap-4">
							{footer.socialLinks.map((social) => {
								const brand = SOCIAL_BRANDS[social.provider];

								return (
									<li key={social.provider}>
										<Link
											href={social.href}
											target="_blank"
											rel="noopener noreferrer"
											aria-label={social.provider}
											className={`flex size-11 items-center justify-center rounded-full ${SOCIAL_COLORS[social.provider]}`}
										>
											{brand ? (
												<BrandIcon icon={brand} aria-hidden className="size-5" />
											) : (
												// LinkedIn removed its mark from Simple Icons; its packaged brand glyph remains isolated here.
												<HugeiconsIcon icon={Linkedin01Icon} aria-hidden className="size-5" />
											)}
										</Link>
									</li>
								);
							})}
						</ul>
					</FooterColumn>
				)}
			</div>

			{footer.funders.length > 0 && (
				<section
					aria-label={tUI("fundingPartner")}
					className="flex w-full max-w-site flex-wrap items-center justify-center gap-8 border-t border-black/10 pt-8 dark:border-white/10"
				>
					{footer.funders.map((funder) => {
						const content = (
							<span className="flex items-center gap-3 text-black/70 dark:text-white/70">
								{funder.logoUrl && (
									<FunderLogo
										alt={funder.name}
										logoUrl={funder.logoUrl}
									/>
								)}
								{!funder.logoUrl && (
									<span className="font-medium">
										{funder.name}
									</span>
								)}
							</span>
						);

						return funder.href ? (
							<Link
								key={funder.id}
								href={funder.href}
								target="_blank"
								rel="noopener noreferrer"
							>
								{content}
							</Link>
						) : (
							<span key={funder.id}>{content}</span>
						);
					})}
				</section>
			)}

			{(footer.disclaimer || footer.attribution || footer.poweredBy) && (
				<div className="flex w-full max-w-4xl flex-col gap-4 text-center text-sm text-black/60 dark:text-white/60">
					{footer.disclaimer && (
						<p className="whitespace-pre-line">
							{footer.disclaimer}
						</p>
					)}
					{footer.attribution && (
						<p className="whitespace-pre-line">
							{footer.attribution}
						</p>
					)}
					{footer.poweredBy && (
						<p data-library-powered-by="">
							<a
								href="https://openscholar.ai"
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-accent"
							>
								{t("poweredBy")}
							</a>
						</p>
					)}
				</div>
			)}

			{onPolicyPage && (
				<DialogModal
					scrollBehavior="inside"
					isDismissable
					size="lg"
					isOpen={policyDialogOpen}
					onClose={() => setPolicyDialogOpen(false)}
					backdrop="opaque"
					classNames={{
						base: "max-h-dvh border border-divider bg-background_light dark:bg-card",
					}}
				>
					<AnalyticsConsentDialogContent
						onComplete={() => {
							setPolicyDialogOpen(false);
							router.push("/");
						}}
					/>
				</DialogModal>
			)}

			<div className="absolute bottom-0 left-0 p-2 text-xs text-black/60 dark:text-white/60">
				0.8.5
			</div>
		</footer>
	);
}
