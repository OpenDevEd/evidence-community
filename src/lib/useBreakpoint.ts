import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "@/../tailwind.config";
import { useEffect, useState } from "react";
import { useMediaQuery } from 'usehooks-ts'

const fullConfig = resolveConfig(tailwindConfig);
const {
  theme: { screens },
} = fullConfig;

export default function useBreakpoint(query: keyof typeof screens): boolean {
  const mediaQuery = `(min-width: ${screens[query]})`;
  const matches = useMediaQuery(mediaQuery);

  return matches
}
