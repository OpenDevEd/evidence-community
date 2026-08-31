"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowRight01Icon, MapsIcon } from "@hugeicons/core-free-icons";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/nextui/Card";
import { useGapMaps } from "@/context/Providers";
import { useTranslations } from "next-intl";
function GapMapCard({
	label,
	description,
	href,
}: {
	label: string;
	description?: string;
	href: string;
}) {
	const t = useTranslations("ui");

	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="group block"
		>
			<Card
				color="card"
				className="h-full transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:shadow-lg hover:shadow-accent/5 dark:hover:shadow-accent/10 hover:border-accent/30 dark:hover:border-accent/40"
			>
				<div className="flex flex-col gap-5 p-5">
					{/* Icon badge */}
					<div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 group-hover:bg-accent/20 transition-colors duration-300">
						<HugeiconsIcon icon={MapsIcon} className="size-5 text-accent" />
					</div>

					{/* Text content */}
					<div className="flex flex-col gap-2 min-h-[4.5rem]">
						<h3 className="text-lg font-semibold text-black/80 dark:text-white/90 group-hover:text-accent transition-colors duration-300 line-clamp-2">
							{label}
						</h3>
						{description && (
							<p className="text-sm text-black/50 dark:text-white/50 leading-relaxed line-clamp-3">
								{description}
							</p>
						)}
					</div>

					{/* CTA */}
					<div className="flex items-center gap-2 text-sm font-medium text-accent/80 group-hover:text-accent transition-colors duration-300 pt-1">
						<span>{t("openGapMap")}</span>
						<HugeiconsIcon icon={ArrowRight01Icon} className="size-3 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
					</div>
				</div>
			</Card>
		</a>
	);
}

export default function GapMaps() {
	const gapmaps = useGapMaps();
	const tPage = useTranslations("gapmapsPage");

	return (
		<PageContainer>
			<div className="py-6">
				{/* Header — Option 18 */}
				<div className="mb-10 lg:mb-14">
					<div className="flex flex-col gap-6">
						<h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold tracking-tight text-center">
							{tPage("title")}
						</h1>
						<div className="flex items-center gap-4">
							<div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
							<div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10 shrink-0">
								<HugeiconsIcon icon={MapsIcon} className="size-4 text-accent" />
							</div>
							<div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
						</div>
						<p className="text-lg text-black/50 dark:text-white/50 leading-relaxed max-w-xl mx-auto text-center">
							{tPage("subtitle")}
						</p>
					</div>
				</div>

				{/* Card grid */}
				{gapmaps.length > 0 ? (
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
						{gapmaps.map((gm) => (
							<GapMapCard
								key={gm.slug}
								label={gm.label}
								description={gm.description}
								href={gm.href}
							/>
						))}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-20 gap-4">
						<div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-black/[3%] dark:bg-white/[3%]">
							<HugeiconsIcon icon={MapsIcon} className="size-7 text-black/20 dark:text-white/20" />
						</div>
						<p className="text-black/40 dark:text-white/40 text-lg">
							{tPage("empty")}
						</p>
					</div>
				)}
			</div>
		</PageContainer>
	);
}
