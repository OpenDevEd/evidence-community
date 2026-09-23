"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { COUNTRIES, getSafeReferrer } from "@/constants/misc";
import LinkWithParams from "../LinkWithParams";
import { getCountryAncestry } from "@/lib/utils";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import Image from "next/image";

interface CountryDisplayProps {
	countries: string[];
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

interface BackgroundLayerProps {
	country: string;
	isHovered: boolean;
}

const BackgroundLayer = ({
	country,
	isHovered,
}: BackgroundLayerProps) => (
	<>
		{/* Base background */}
		<div className="absolute inset-0 z-0 bg-gradient-to-br from-white/90 via-white/80 to-background/5 dark:hidden" />
		<div className="absolute inset-0 z-0 hidden bg-gradient-to-br from-background/80 to-background/40 dark:block" />

		{/* Blurred flag background */}
		<motion.div
			className="absolute inset-0 z-[1] h-full w-full mix-blend-multiply dark:hidden"
			initial={{ opacity: 0 }}
			animate={{ opacity: isHovered ? 0.75 : 0 }}
			transition={{ duration: 0.4 }}
			style={{
				backgroundImage: `url(https://flagcdn.com/w640/${country.toLowerCase()}.png)`,
				backgroundSize: "150% 150%",
				backgroundPosition: "center",
				filter: "blur(20px)",
				transform: "scale(1.2)",
			}}
		/>
		<motion.div
			className="absolute inset-0 z-[1] hidden h-full w-full dark:block"
			initial={{ opacity: 0 }}
			animate={{ opacity: isHovered ? 0.5 : 0 }}
			transition={{ duration: 0.4 }}
			style={{
				backgroundImage: `url(https://flagcdn.com/w640/${country.toLowerCase()}.png)`,
				backgroundSize: "150% 150%",
				backgroundPosition: "center",
				filter: "blur(20px)",
				transform: "scale(1.2)",
			}}
		/>

		{/* Gradient overlay */}
		<motion.div
			className="absolute inset-0 z-[2] bg-gradient-to-br from-white/90 via-white/85 to-white/80 dark:hidden"
			initial={{ opacity: 0.7 }}
			animate={{ opacity: isHovered ? 0.95 : 0.7 }}
			transition={{ duration: 0.3 }}
		/>
		<motion.div
			className="absolute inset-0 z-[2] hidden bg-gradient-to-br from-background via-background/80 to-transparent dark:block"
			initial={{ opacity: 0.7 }}
			animate={{ opacity: isHovered ? 0.85 : 0.7 }}
			transition={{ duration: 0.3 }}
		/>
	</>
);

interface FlagImageProps {
	country: string;
	isHovered: boolean;
}

const FlagImage = ({ country, isHovered }: FlagImageProps) => (
	<div className="relative group">
		<motion.div
			className="relative z-[6] h-12 w-16 overflow-hidden rounded-lg shadow-lg shadow-black/5 dark:shadow-black/10"
			whileHover={{ scale: 1.1 }}
			transition={{ type: "spring", stiffness: 400, damping: 10 }}
		>
			<Image unoptimized
				src={`https://flagcdn.com/w160/${country.toLowerCase()}.png`}
				alt={`${country} flag`}
				fill
				sizes="4rem"
				className="object-cover"
				loading="lazy"
			/>
			<motion.div
				className="absolute inset-0 bg-black/0 z-[7]"
				whileHover={{ backgroundColor: "rgba(0,0,0,0.1)" }}
			/>
		</motion.div>
		<motion.div
			className="absolute -bottom-1 -right-1 z-[4] h-full w-full rounded-lg bg-accent/15 blur-xl dark:bg-accent/20"
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
					"relative h-full overflow-hidden rounded-xl border p-4 transition-shadow duration-300 dark:border-white/10",
					isHovered
						? "shadow-xl shadow-black/[0.12] dark:shadow-black/20"
						: "shadow-medium dark:shadow-lg"
				)}
				initial={false}
			>
				<BackgroundLayer
					country={country}
					isHovered={isHovered}
				/>

				<div className="relative flex items-center gap-4 z-[5]">
					<FlagImage
						country={country}
						isHovered={isHovered}
					/>

					<div className="flex-1 min-w-0 relative z-[6] pr-6">
						<div className="flex items-center gap-2 mb-1 w-full">
							<motion.span
								className="shrink-0 font-mono text-sm font-bold text-accent/90 dark:text-accent"
								animate={{
									opacity: isHovered ? 1 : 0.8,
								}}
							>
								{country}
							</motion.span>
							<motion.h3
								className={twMerge(
									"flex-1 truncate text-lg font-semibold transition-colors",
									isHovered
										? "text-accent"
										: "text-black/90 dark:text-white/90"
								)}
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
							className="text-sm text-black/60 dark:text-default-500"
						>
							<div className="flex items-center gap-1">
								<HugeiconsIcon icon={Globe02Icon} className="text-accent/80 dark:text-accent" />
								{t("itemFilterByCountryAriaLabel")}
							</div>
						</motion.div>
					</div>

					<motion.div
						className="absolute right-2 top-2 z-[6] h-2 w-2 rounded-full bg-accent/90 dark:bg-accent"
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
}: CountryDisplayProps) {
	const [referrer] = useQueryState("referrer");
	const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
	const isCountryFocusEnabled =
		useLibraryFeature("countryFocus");

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
