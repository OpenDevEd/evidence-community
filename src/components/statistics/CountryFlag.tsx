import { BsGlobe } from "react-icons/bs";

type CountryFlagProps = {
	countryCode: string;
	className?: string;
};

export function CountryFlag({ countryCode, className = "w-6 h-4" }: CountryFlagProps) {
	if (!countryCode || countryCode.trim() === '') {
		return (
			<div className={`${className} rounded-sm bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0`}>
				<BsGlobe className="w-3 h-3 text-black/40 dark:text-white/40" />
			</div>
		);
	}
	
	return (
		<div className={`${className} rounded-sm overflow-hidden shadow-sm flex-shrink-0`}>
			<img
				src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
				alt={countryCode}
				className="w-full h-full object-cover"
			/>
		</div>
	);
} 