import { useTranslations } from "next-intl";
import { CountryFlag } from "./CountryFlag";

type CountryDisplayProps = {
	countryCode: string;
	countryName: string;
	showCode?: boolean;
};

export function CountryDisplay({ countryCode, countryName, showCode = false }: CountryDisplayProps) {
	const t = useTranslations("ui");
	
	if (!countryCode || countryCode.trim() === '') {
		return (
			<div className="flex items-center gap-2">
				<CountryFlag countryCode="" />
				<span className="text-sm font-medium text-black/60 dark:text-white/60">{t("unknownCountry")}</span>
			</div>
		);
	}
	
	return (
		<div className="flex items-center gap-2">
			<CountryFlag countryCode={countryCode} />
			<span className="text-sm font-medium">
				{countryName || countryCode}
				{showCode && countryName && (
					<span className="text-xs text-black/60 dark:text-white/60 ml-1">({countryCode})</span>
				)}
			</span>
		</div>
	);
} 