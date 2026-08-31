import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Globe02Icon } from "@hugeicons/core-free-icons";
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
			<Image
				src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
				alt={countryCode}
				className="w-full h-full object-cover"
				width={24}
				height={16}
			/>
		</div>
	);
}
