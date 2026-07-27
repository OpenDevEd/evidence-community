"use client";

/* Runtime asset hosts cannot be known to next/image at build time. */
/* eslint-disable @next/next/no-img-element */

import {
	useCallback,
	useEffect,
	useRef,
} from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";

import { LIBRARY_LOGO_ATTRIBUTES } from "@/config/library-config/identity";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export function LibraryLogoImages({
	className,
	onLoad,
}: {
	className?: string;
	onLoad?: () => void;
}) {
	const { identity } = useLibraryConfig();
	const t = useTranslations("ui");
	const lightLogoRef = useRef<HTMLImageElement>(null);
	const darkLogoRef = useRef<HTMLImageElement>(null);
	const hasReportedReady = useRef(false);
	const reportReady = useCallback(() => {
		if (hasReportedReady.current) return;
		hasReportedReady.current = true;
		onLoad?.();
	}, [onLoad]);

	useEffect(() => {
		if (
			lightLogoRef.current?.complete ||
			darkLogoRef.current?.complete
		) {
			reportReady();
		}
	}, [reportReady]);

	return (
		<>
			<img
				{...LIBRARY_LOGO_ATTRIBUTES}
				ref={lightLogoRef}
				alt={t("logoAlt", {
					company: identity.name,
					theme: "light",
				})}
				className={twMerge("dark:hidden", className)}
				onError={reportReady}
				onLoad={reportReady}
				src={identity.assets.logoLight}
			/>
			<img
				{...LIBRARY_LOGO_ATTRIBUTES}
				ref={darkLogoRef}
				alt={t("logoAlt", {
					company: identity.name,
					theme: "dark",
				})}
				className={twMerge("hidden dark:block", className)}
				onError={reportReady}
				onLoad={reportReady}
				src={identity.assets.logoDark}
			/>
		</>
	);
}

export function FundingPartners({ className }: { className?: string }) {
	const { fundingPartners } = useLibraryConfig().identity;
	const t = useTranslations("ui");
	if (fundingPartners.length === 0) return null;

	return (
		<ul
			aria-label={t("fundingPartner")}
			className={twMerge("flex flex-wrap gap-x-3 gap-y-1", className)}
		>
			{fundingPartners.map((partner) => (
				<li key={partner.id}>{partner.name}</li>
			))}
		</ul>
	);
}
