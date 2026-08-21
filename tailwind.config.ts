import type { Config } from "tailwindcss";
import { nextui } from "@nextui-org/react";
import containerQueries from "@tailwindcss/container-queries";
import typography from "@tailwindcss/typography";

import { BREAKPOINTS } from "./design-tokens";

const SHADES = [
	"50",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
] as const;

function runtimeColor(variable: string) {
	return `rgb(var(${variable}) / calc(var(${variable}-alpha) * <alpha-value>))`;
}

function runtimePalette(name: string) {
	const shades = Object.fromEntries(
		SHADES.map((shade) => [
			shade,
			runtimeColor(`--color-${name}-${shade}`),
		]),
	);

	return {
		DEFAULT: runtimeColor(`--color-${name}-500`),
		...shades,
	};
}

const colors = {
	background: runtimePalette("background"),
	background_light: runtimePalette("background_light"),
	accent: runtimePalette("accent"),
	link: runtimePalette("link"),
	collection: runtimePalette("collection"),
	doi: runtimePalette("doi"),
	tertiary: runtimePalette("tertiary"),
	card: runtimePalette("card"),
	card_light: runtimePalette("card_light"),
	primary: {
		DEFAULT: "#ffffff",
		100: "#333333",
		200: "#666666",
		300: "#999999",
		400: "#cccccc",
		500: "#ffffff",
		600: "#ffffff",
		700: "#ffffff",
		800: "#ffffff",
		900: "#ffffff",
	},
	secondary: {
		DEFAULT: "#1e1e1e",
		100: "#060606",
		200: "#0c0c0c",
		300: "#121212",
		400: "#181818",
		500: "#1e1e1e",
		600: "#4b4b4b",
		700: "#787878",
		800: "#a5a5a5",
		900: "#d2d2d2",
	},
};

const config: Config = {
	content: [
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
		"./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
		"./src/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
			extend: {
			colors,
			gridTemplateRows: {
				chat: "minmax(0, 1fr) auto",
			},
			letterSpacing: {
				"inspector-title": "-0.01em",
			},
			fontFamily: {
				sans: ["var(--font-body)", "sans-serif"],
				heading: ["var(--font-heading)", "sans-serif"],
				base: ["var(--font-body)", "sans-serif"],
			},
			screens: {
				...BREAKPOINTS,
				print: { raw: "print" },
				screen: { raw: "screen" },
				"max-2xl": { max: "1535px" },
				"max-xl": { max: "1279px" },
				"max-lg": { max: "1023px" },
				"max-md": { max: "767px" },
				"max-sm": { max: "639px" },
			},
			transitionTimingFunction: {
				spring: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
				"bounce-custom":
					"cubic-bezier(0.68, -0.55, 0.265, 1.55)",
			},
			boxShadow: {
				"accent-glow":
					"0 0 15px theme(colors.accent.DEFAULT / 0.25)",
			},
			keyframes: {
				"gradient-x": {
					"0%": { backgroundPosition: "0% 50%" },
					"50%": { backgroundPosition: "100% 50%" },
					"100%": { backgroundPosition: "0% 50%" },
				},
			},
			animation: {
				"gradient-x": "gradient-x 2s ease infinite",
			},
		},
	},
	darkMode: "class",
	plugins: [
		function ({
			addUtilities,
		}: {
			addUtilities: (
				utilities: Record<string, Record<string, string>>,
			) => void;
		}) {
			addUtilities({
				".text-wrap-anywhere": {
					whiteSpace: "normal",
					overflowWrap: "anywhere",
					wordBreak: "break-word",
				},
			});
		},
		containerQueries,
		typography,
		nextui({
			themes: {
				dark: {
					colors: {
						focus: "#e68124",
					},
				},
				light: {
					colors: {
						focus: "#e68124",
					},
				},
			},
		}),
	],
};

export default config;
