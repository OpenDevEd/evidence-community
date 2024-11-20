import type { Config } from "tailwindcss";
import { nextui } from "@nextui-org/react";

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
    900: "#FCFBFA"
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
  tertiary: {
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
  },
  accent: {
    DEFAULT: "#e68124",
    100: "#301a05",
    200: "#5f340b",
    300: "#8f4d10",
    400: "#bf6715",
    500: "#e68124",
    600: "#eb9a4f",
    700: "#f0b47b",
    800: "#f5cda7",
    900: "#fae6d3",
  }
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...colors,
      },
    },
  },
  darkMode: "class",
  plugins: [nextui({
    themes: {
      dark: {
        colors: {
          focus: colors.accent,
        }
      },
      light: {
        colors: {
          focus: colors.accent,
        }
      }
    }
  })],
};
export default config;
