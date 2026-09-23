import type { Config } from "tailwindcss";
import { nextui } from "@nextui-org/react";
import containerQueries from "@tailwindcss/container-queries";
import typography from "@tailwindcss/typography";
import tailwindcssAnimate from "tailwindcss-animate";

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
	zenodo: "#1682D4",
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
		"./node_modules/streamdown/dist/*.js",
		"./src/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			colors,
			gridTemplateRows: {
				chat: "minmax(0, 1fr) auto",
			},
			spacing: {
				"collection-tooltip": "200px",
				// Where the header sits once it has shrunk for the chat.
				split: "1.625rem",
				// The library's AI panel column.
				"ai-panel": "2.375rem",
				// Lines up a tool step's details under its title.
				"tool-step": "1.375rem",
				// Small icon sizes shared by chat and citation controls.
				"icon-md": "1.125rem",
				"icon-xs": "0.6875rem",
				"catalogue-icon": "13px",
			},
			fontSize: {
				"inspector-title": "17px",
				"catalogue-label": "12px",
				citation: "0.68rem",
			},
			borderRadius: {
				favicon: "0.2rem",
			},
			transitionProperty: {
				"background-text": "background-color, color",
				"background-fill": "background-color",
				"filter-control":
					"background-color, border-color, color, box-shadow",
				// What moves when the chat opens beside the results.
				chrome: "transform, border-radius",
				header: "height, padding",
				"page-space": "padding",
				composer: "border-color, box-shadow",
				citation:
					"transform, border-color, background-color, box-shadow, color",
			},
			transformOrigin: {
				"hover-card":
					"var(--radix-hover-card-content-transform-origin)",
			},
			zIndex: {
				"hover-card": "10000",
			},
			maxWidth: {
				chat: "96rem",
				// Everything on a page lines up with the header's width.
				site: "96rem",
				// The workbench row: the record's own controls.
				"workbench-control": "120px",
				"workbench-field": "520px",
				// A long filter name is cut short so the row still fits.
				"filter-chip": "16rem",
				"results-note": "16rem",
				// How wide a library logo may grow in each bar.
				"logo-header": "12rem",
				"logo-footer": "14rem",
				"logo-cookie": "9rem",
				"logo-funder": "10rem",
				"logo-admin": "9rem",
			},
			scale: {
				// The Ask AI button lifts a little under the pointer.
				97: "0.97",
				102: "1.02",
			},
			transitionDuration: {
				// The header and the chat column open and close together.
				split: "450ms",
			},
			height: {
				navbar: "6.5rem",
				"generative-modal": "45rem",
				// The chat beside the results fills the viewport minus the
				// header stack above it, which differs per breakpoint.
				"chat-column": "calc(100dvh - 14rem)",
				"chat-column-lg": "calc(100dvh - 6.5rem)",
				"chat-column-small": "calc(100dvh - 9.625rem)",
				"chat-column-small-xl": "calc(100dvh - 8rem)",
			},
			minHeight: {
				"chat-column": "28rem",
			},
			minWidth: {
				"workbench-field": "260px",
				"author-popover": "300px",
			},
			width: {
				"admin-filter": "min(420px, calc(100vw - 24px))",
				dialog: "calc(100% - 2rem)",
				// While a logo picture loads its box holds the widest that
				// logo may ever be, so the bar does not jump when it lands.
				"logo-header": "12rem",
				"logo-footer": "14rem",
				"workbench-control": "120px",
				"workbench-list": "150px",
			},
			gridTemplateColumns: {
				"filter-rule": "minmax(0,1fr) minmax(0,1fr) 2rem",
				// The workbench row: what changed, then its two controls.
				"workbench-row": "minmax(0,1fr) auto auto",
				// The workbench itself: records, the record, its details.
				workbench: "240px minmax(0,1fr) 360px",
			},
			backgroundSize: {
				shimmer: "200% 100%",
			},
			maxHeight: {
				"column-picker": "420px",
				"admin-filter": "calc(100dvh - 72px)",
				// The navbar suggestion list must not cover the whole screen.
				suggestions: "70vh",
				"results-note": "32rem",
				// A long list inside the workbench scrolls rather than
				// pushing everything below it off the screen.
				"workbench-menu": "52vh",
				// The filter chips grow to fit, up to most of the screen.
				"filter-chips": "32rem",
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
				// The header and the chat column open and close together.
				split: "cubic-bezier(0.16,1,0.3,1)",
				spring: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
				"bounce-custom": "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
			},
			boxShadow: {
				"filter-control": "inset 0 1px 0 rgba(255,255,255,0.45)",
				"filter-control-dark": "inset 0 1px 0 rgba(255,255,255,0.05)",
				"card-soft": "0 4px 20px rgba(0, 0, 0, 0.05)",
				"card-flat": "0 4px 20px rgba(0, 0, 0, 0.04)",
				"card-hairline": "0 1px 0 rgba(0, 0, 0, 0.035)",
				"card-lifted": "0 14px 36px -30px rgba(0, 0, 0, 0.45)",
				composer: "0 12px 40px -34px rgba(0, 0, 0, 0.45)",
				"composer-focus": "0 18px 48px -32px rgba(235, 126, 29, 0.22)",
				"composer-focus-dark":
					"0 18px 48px -32px rgba(235, 126, 29, 0.38)",
				"accent-glow": "0 0 15px theme(colors.accent.DEFAULT / 0.25)",
			},
			keyframes: {
				"gradient-x": {
					"0%": { backgroundPosition: "0% 50%" },
					"50%": { backgroundPosition: "100% 50%" },
					"100%": { backgroundPosition: "0% 50%" },
				},
				"fade-in": {
					"0%": { opacity: "0" },
					"100%": { opacity: "1" },
				},
				marquee: {
					"0%": { transform: "translateX(0)" },
					"100%": { transform: "translateX(-50%)" },
				},
				"read-dot": {
					"0%, 100%": { opacity: "0.2" },
					"50%": { opacity: "1" },
				},
				"marquee-up": {
					"0%": { transform: "translateY(0)" },
					"100%": { transform: "translateY(-50%)" },
				},
				"hero-rise": {
					"0%": { opacity: "0", transform: "translateY(28px)" },
					"100%": { opacity: "1", transform: "translateY(0)" },
				},
				"rise-in": {
					"0%": {
						opacity: "0",
						transform: "scale(0.9) translateY(4px)",
					},
					"100%": {
						opacity: "1",
						transform: "scale(1) translateY(0)",
					},
				},
			},
			animation: {
				"gradient-x": "gradient-x 2s ease infinite",
				// "backwards" rather than "both", so the last frame stops
				// applying once it is done and hover still moves the button.
				"fade-in": "fade-in 0.6s ease-out backwards",
				"rise-in":
					"rise-in 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) backwards",
				// CSS rather than JavaScript, so the page's first paint already plays it.
				"hero-rise": "hero-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) backwards",
				// Content drawn twice, moved by one copy: an endless row. Set the duration where it is used.
				marquee: "marquee 40s linear infinite",
				"marquee-up": "marquee-up 60s linear infinite",
				// A dot of the library lighting up as the assistant reads; delays set where used make the sweep.
				"read-dot": "read-dot 4.5s ease-in-out infinite",
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
		tailwindcssAnimate,
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
