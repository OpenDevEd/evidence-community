"use client";

import { motion, AnimatePresence, Variants } from "framer-motion";
import { useState } from "react";
import { IoGlobeOutline } from "react-icons/io5";
import { useTheme } from "next-themes";
import { twMerge } from "tailwind-merge";
import { COUNTRIES, getSafeReferrer } from "@/constants/misc";
import LinkWithParams from "../LinkWithParams";
import { getCountryAncestry } from "@/lib/utils";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";

interface CountryDisplayProps {
	countries: string[];
	onCountryClick?: (country: string) => void;
}

// Animation variants
const containerVariants: Variants = {
	hidden: { opacity: 0 },
	show: {
		opacity: 1,
		transition: {
			staggerChildren: 0.1,
			delayChildren: 0.3,
		},
	},
};

const itemVariants: Variants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

const pulseVariants: Variants = {
	initial: { scale: 0 },
	animate: {
		scale: [1, 1.2, 1],
		transition: {
			duration: 0.6,
			repeat: Infinity,
			repeatType: "reverse",
		},
	},
};

// Shared styles
const styles = {
	gradients: {
		light: {
			base: "bg-gradient-to-br from-white/90 via-white/80 to-background/5",
			overlay: "bg-gradient-to-br from-white/90 via-white/85 to-white/80",
		},
		dark: {
			base: "bg-gradient-to-br from-background/80 to-background/40",
			overlay:
				"bg-gradient-to-br from-background via-background/80 to-transparent",
		},
	},
};

interface BackgroundLayerProps {
	isLight: boolean;
	country: string;
	isHovered: boolean;
}

const BackgroundLayer = ({
	isLight,
	country,
	isHovered,
}: BackgroundLayerProps) => (
	<>
		{/* Base background */}
		<div
			className={twMerge(
				"absolute inset-0 z-0",
				isLight
					? styles.gradients.light.base
					: styles.gradients.dark.base
			)}
		/>

		{/* Blurred flag background */}
		<motion.div
			className="absolute inset-0 w-full h-full z-[1]"
			initial={{ opacity: 0 }}
			animate={{ opacity: isHovered ? (isLight ? 0.75 : 0.5) : 0 }}
			transition={{ duration: 0.4 }}
			style={{
				backgroundImage: `url(https://flagcdn.com/w640/${country.toLowerCase()}.png)`,
				backgroundSize: "150% 150%",
				backgroundPosition: "center",
				filter: "blur(20px)",
				transform: "scale(1.2)",
				mixBlendMode: isLight ? "multiply" : "normal",
			}}
		/>

		{/* Gradient overlay */}
		<motion.div
			className={twMerge(
				"absolute inset-0 z-[2]",
				isLight
					? styles.gradients.light.overlay
					: styles.gradients.dark.overlay
			)}
			initial={{ opacity: 0.7 }}
			animate={{ opacity: isHovered ? (isLight ? 0.95 : 0.85) : 0.7 }}
			transition={{ duration: 0.3 }}
		/>
	</>
);

interface FlagImageProps {
	country: string;
	isLight: boolean;
	isHovered: boolean;
}

const FlagImage = ({ country, isLight, isHovered }: FlagImageProps) => (
	<div className="relative group">
		<motion.div
			className={twMerge(
				"w-16 h-12 rounded-lg overflow-hidden relative z-[6]",
				isLight ? "shadow-lg shadow-black/5" : "shadow-lg"
			)}
			whileHover={{ scale: 1.1 }}
			transition={{ type: "spring", stiffness: 400, damping: 10 }}
		>
			<img
				src={`https://flagcdn.com/w160/${country.toLowerCase()}.png`}
				alt={`${country} flag`}
				className="w-full h-full object-cover"
				loading="lazy"
			/>
			<motion.div
				className="absolute inset-0 bg-black/0 z-[7]"
				whileHover={{ backgroundColor: "rgba(0,0,0,0.1)" }}
			/>
		</motion.div>
		<motion.div
			className={twMerge(
				"absolute -bottom-1 -right-1 w-full h-full rounded-lg z-[4] blur-xl",
				isLight ? "bg-accent/15" : "bg-accent/20"
			)}
			initial={false}
			animate={{
				scale: isHovered ? 1.1 : 1,
				opacity: isHovered ? 1 : 0,
			}}
		/>
	</div>
);

const CountryCard = ({
	country,
	isHovered,
	onHover,
	onLeave,
}: {
	country: string;
	isHovered: boolean;
	onHover: () => void;
	onLeave: () => void;
}) => {
	const { resolvedTheme: theme, forcedTheme } = useTheme();
	const isLight = (theme === "light" || forcedTheme === "light");
	const countryName = COUNTRIES[country] || country;
	const t = useTranslations("ui");
	
	return (
		<motion.div
			variants={itemVariants}
			whileHover={{ scale: 1.05 }}
			onHoverStart={onHover}
			onHoverEnd={onLeave}
			className="relative w-full"
		>
			<motion.div
				className={twMerge(
					"relative overflow-hidden rounded-xl backdrop-blur-md p-4 h-full transition-shadow duration-300",
					isLight ? "border " : "border border-white/10",
					isHovered
						? isLight
							? "shadow-xl shadow-black/[0.12]"
							: "shadow-xl shadow-black/20"
						: isLight
						? "shadow-medium"
						: "shadow-lg"
				)}
				initial={false}
			>
				<BackgroundLayer
					isLight={isLight}
					country={country}
					isHovered={isHovered}
				/>

				<div className="relative flex items-center gap-4 z-[5]">
					<FlagImage
						country={country}
						isLight={isLight}
						isHovered={isHovered}
					/>

					<div className="flex-1 min-w-0 relative z-[6] pr-6">
						<div className="flex items-center gap-2 mb-1 w-full">
							<motion.span
								className={twMerge(
									"text-sm font-mono font-bold shrink-0",
									isLight ? "text-accent/90" : "text-accent"
								)}
								animate={{
									opacity: isHovered ? 1 : 0.8,
								}}
							>
								{country}
							</motion.span>
							<motion.h3
								className={twMerge(
									"text-lg font-semibold truncate flex-1",
									isLight && "text-black/90"
								)}
								animate={{
									color: isHovered
										? "var(--accent-color)"
										: isLight
										? "rgba(0,0,0,0.9)"
										: "var(--text-color)",
								}}
							>
								{countryName}
							</motion.h3>
						</div>
						<motion.div
							initial={{ opacity: 0, y: 10 }}
							animate={{
								opacity: isHovered ? 1 : 0,
								y: isHovered ? 0 : 10,
							}}
							className={twMerge(
								"text-sm",
								isLight ? "text-black/60" : "text-default-500"
							)}
						>
							<div className="flex items-center gap-1">
								<IoGlobeOutline
									className={
										isLight
											? "text-accent/80"
											: "text-accent"
									}
								/>
								{t("itemFilterByCountryAriaLabel")}
							</div>
						</motion.div>
					</div>

					<motion.div
						className={twMerge(
							"absolute top-2 right-2 w-2 h-2 rounded-full z-[6]",
							isLight ? "bg-accent/90" : "bg-accent"
						)}
						initial="initial"
						animate={isHovered ? "animate" : "initial"}
						variants={pulseVariants}
					/>
				</div>
			</motion.div>
		</motion.div>
	);
};

export function CountryDisplay({
	countries,
	onCountryClick,
}: CountryDisplayProps) {
	const [referrer, setReferrer] = useQueryState("referrer");
	const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
	const isCountryFocusEnabled = useFeatureFlagEnabled("country-focus");

	return (
		<motion.div
			variants={containerVariants}
			initial="hidden"
			animate="show"
			className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
		>
			<AnimatePresence>
				{countries.map((country) => {
					const ancestry = getCountryAncestry(country);
					return (
						<LinkWithParams
							href={isCountryFocusEnabled ? getSafeReferrer(referrer) : undefined}
							params={
								ancestry && isCountryFocusEnabled
									? { country: ancestry, referrer: referrer ?? undefined }
									: {}
							}
							key={country}
							className="opacity-100"
						>
							<CountryCard
								country={country}
								isHovered={hoveredCountry === country}
								onHover={() => setHoveredCountry(country)}
								onLeave={() => setHoveredCountry(null)}
							/>
						</LinkWithParams>
					);
				})}
			</AnimatePresence>
		</motion.div>
	);
}
