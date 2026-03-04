import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";
import jsonConfig from "./src/constants/config.json";

export const style = process.env.NEXT_PUBLIC_STYLE || jsonConfig?.style || "small";
export const accent = process.env.NEXT_PUBLIC_ACCENT_COLOR || jsonConfig?.accent || "opendeved";
export const link = process.env.NEXT_PUBLIC_LINK_COLOR || accent || "opendeved";
export const collection = process.env.NEXT_PUBLIC_COLLECTION_COLOR || accent || "opendeved";
export const doi = process.env.NEXT_PUBLIC_DOI_COLOR || accent || "opendeved";

const accentColors = {
  "opendeved": "#e68124",
  "edtechhub": "#DC3900",
  "ekitabu": "#ed1c24",
  "openalex": "#1976d2",
  "jacob": "#FFDE2D",
  "kaleidoscopio": "#ef4129",
  "jimma": "#4a94d6",
  "fcdo": "#CC0000",
  "unlockingdata": "#009900",
}

const tertiary = {
  DEFAULT: "#5cacfd",
  50: "#161F27",
  100: "#012345",
  200: "#014589",
  300: "#0268ce",
  400: "#198bfd",
  500: "#5cacfd",
  600: "#7ebefe",
  700: "#9ecefe",
  800: "#bedefe",
  900: "#dfefff",
}

function generateColorVariants(baseColor: string, light: boolean = false) {
  // Split the baseColor into dark and light variants if separator exists
  const [darkColor, lightColor] = baseColor.split('|').map(c => c.trim());
  const colorToUse = light && lightColor ? lightColor : darkColor;

  const normalizeHex = (hex: string) => hex.replace('#', '');

  const parseColor = (color: string): [number, number, number] => {
    // Check if color is in RGB format
    const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1]),
        parseInt(rgbMatch[2]),
        parseInt(rgbMatch[3])
      ];
    }

    // Otherwise treat as hex
    const normalized = normalizeHex(color);
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16)
    ];
  };

  const rgbToHex = (r: number, g: number, b: number): string => {
    const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const adjustBrightness = (rgb: [number, number, number], factor: number): string => {
    return rgbToHex(
      rgb[0] * factor,
      rgb[1] * factor,
      rgb[2] * factor
    );
  };

  const rgb = parseColor(colorToUse);

  const variations = {
    DEFAULT: colorToUse,
    100: adjustBrightness(rgb, 0.2),
    200: adjustBrightness(rgb, 0.4),
    300: adjustBrightness(rgb, 0.6),
    400: adjustBrightness(rgb, 0.8),
    500: colorToUse,
    600: adjustBrightness(rgb, 1.15),
    700: adjustBrightness(rgb, 1.3),
    800: adjustBrightness(rgb, 1.45),
    900: adjustBrightness(rgb, 1.6)
  };

  return variations;
}

const colors = {
  background: {
    DEFAULT: "#0f0f0f",
    100: "#030303",
    200: "#060606",
    300: "#090909",
    400: "#0c0c0c",
    500: "#0f0f0f",
    600: "#3f3f3f",
    700: "#6f6f6f",
    800: "#9f9f9f",
    900: "#cfcfcf",
  },
  background_light: {
    DEFAULT: "#F4F2EE",
    100: "#312F2D",
    200: "#625E5A",
    300: "#938E87",
    400: "#C4BDB5",
    500: "#F4F2EE",
    600: "#F6F4F1",
    700: "#F8F7F4",
    800: "#FAF9F7",
    900: "#FCFBFA",
  },
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
  tertiary: process.env.NEXT_PUBLIC_TERTIARY_COLOR ? generateColorVariants(process.env.NEXT_PUBLIC_TERTIARY_COLOR, false) : tertiary,
  tertiary_light: process.env.NEXT_PUBLIC_TERTIARY_COLOR ? generateColorVariants(process.env.NEXT_PUBLIC_TERTIARY_COLOR, true) : tertiary,
  accent: generateColorVariants(accentColors[accent as keyof typeof accentColors] ?? accent, false),
  accent_light: generateColorVariants(accentColors[accent as keyof typeof accentColors] ?? accent, true),
  link: generateColorVariants(accentColors[link as keyof typeof accentColors] ?? link, false),
  link_light: generateColorVariants(accentColors[link as keyof typeof accentColors] ?? link, true),
  collection: generateColorVariants(accentColors[collection as keyof typeof accentColors] ?? collection, false),
  collection_light: generateColorVariants(accentColors[collection as keyof typeof accentColors] ?? collection, true),
  doi: generateColorVariants(accentColors[doi as keyof typeof accentColors] ?? doi, false),
  doi_light: generateColorVariants(accentColors[doi as keyof typeof accentColors] ?? doi, true),
  card: {
    DEFAULT: "#141414",
    100: "#040404",
    200: "#080808",
    300: "#0c0c0c",
    400: "#101010",
    500: "#141414",
    600: "#434343",
    700: "#727272",
    800: "#a1a1a1",
    900: "#d0d0d0",
  },
};

export const themeColors = colors;

export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
  "max-2xl": { max: "1535px" },
  "max-xl": { max: "1279px" },
  "max-lg": { max: "1023px" },
  "max-md": { max: "767px" },
  "max-sm": { max: "639px" },
} as const;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...colors,
      },
      screens: breakpoints,
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
        'bounce-custom': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      boxShadow: {
        'accent-glow': '0 0 15px theme(colors.accent.DEFAULT / 0.25)',
      },
      keyframes: {
        'gradient-x': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
      },
      animation: {
        'gradient-x': 'gradient-x 2s ease infinite',
      },
    },
  },
  darkMode: "class",
  plugins: [
    function ({ addUtilities }: { addUtilities: (utilities: Record<string, any>) => void }) {
      addUtilities({
        '.text-wrap-anywhere': {
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }
      });
    },
    require('@tailwindcss/typography'),
    heroui({
      themes: {
        dark: {
          colors: {
            focus: colors.accent,
          },
        },
        light: {
          colors: {
            focus: colors.accent,
          },
        },
      },
    }),
  ],
};
export default config;
