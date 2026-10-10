import { Montserrat, Poppins, Ubuntu } from "next/font/google";

import type { PLATFORM_FONT_CATALOG } from "@/config/library-config/catalogs";

// The fonts a library can choose from Google (PLATFORM_FONT_CATALOG), self-hosted
// by next/font with a size-adjusted fallback. A page renders only the variables
// of the fonts its library uses, so only those are preloaded.
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });
const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "700"], variable: "--font-poppins" });
const ubuntu = Ubuntu({ subsets: ["latin"], weight: ["300", "400", "500", "700"], variable: "--font-ubuntu" });

export const PLATFORM_FONTS = { Montserrat: montserrat, Poppins: poppins, Ubuntu: ubuntu } satisfies Record<
	keyof typeof PLATFORM_FONT_CATALOG,
	{ variable: string }
>;
