import { Globe02Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { SectionCard } from "./SectionCard";

type LanguageDistributionProps = {
	languageDistribution: { language: string; count: number }[];
};

export function LanguageDistribution({ languageDistribution }: LanguageDistributionProps) {
	const t = useTranslations("ui");

	return (
		<SectionCard title={t("languageDistribution")} icon={Globe02Icon}>
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
				{languageDistribution.map((lang, index) => (
					<div
						key={index}
						className="text-center p-4 rounded-xl bg-black/5 dark:bg-white/5"
					>
						<div className="font-bold text-black dark:text-white">
							{lang.language}
						</div>
						<div className="text-sm text-black/60 dark:text-white/60">
							{lang.count.toLocaleString()}
						</div>
					</div>
				))}
			</div>
		</SectionCard>
	);
} 