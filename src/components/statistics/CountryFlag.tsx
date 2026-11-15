import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import Image from "next/image";

type CountryFlagProps = {
	countryCode: string;
	className?: string;
};

export function CountryFlag({ countryCode, className = "w-6 h-4" }: CountryFlagProps) {
	if (!countryCode || countryCode.trim() === '') {
		return (
			<div className={`${className} rounded-sm bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0`}>
				<HugeiconsIcon icon={Globe02Icon} className="w-3 h-3 text-black/40 dark:text-white/40" />
			</div>
		);
	}
	
	return (
		<div className={`${className} rounded-sm overflow-hidden shadow-sm flex-shrink-0`}>
			<Image unoptimized
				src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
				alt={countryCode}
				className="w-full h-full object-cover"
				width={24}
				height={16}
			/>
		</div>
	);
}

/** A country in a statistics table: its flag on the line of its name, its code under the name. */
export function CountryCell({ country }: { country: { countryCode: string; countryName?: string | null } }) {
	const t = useTranslations("ui");
	return (
		<div className="flex items-center gap-3">
			<CountryFlag countryCode={country.countryCode} className="mt-1 h-4 w-6 self-start" />
			<div>
				<div className="font-medium">{country.countryName || country.countryCode || t("unknownCountry")}</div>
				{country.countryCode && <div className="text-xs text-black/60 dark:text-white/60">{country.countryCode}</div>}
			</div>
		</div>
	);
}
