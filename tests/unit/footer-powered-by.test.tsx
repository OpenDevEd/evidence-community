import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Footer from "@/components/layout/Footer";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
	default: () => ({ auth: vi.fn(), handlers: {} }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/lib" }));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
	useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/features/analytics/AnalyticsConsentProvider", () => ({
	useAnalyticsConsent: () => ({
		openPreferences: vi.fn(),
		setConsentState: vi.fn(),
	}),
}));
vi.mock("@/components/library/LibraryIdentity", () => ({
	FunderLogo: () => null,
	FundingPartners: () => null,
	InstitutionLogo: () => null,
	LibraryLogo: () => null,
	LibraryLogoImages: () => null,
}));

const configState = { poweredBy: true };

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => {
		const config = projectPublicLibraryConfig(
			libraryConfigSchema.parse({
				...minimalLibraryConfig,
				footer: { poweredBy: configState.poweredBy },
			}),
		);
		return config;
	},
}));

describe("footer powered-by link", () => {
	it("links to OpenScholar when the setting is on", () => {
		configState.poweredBy = true;
		const markup = renderToStaticMarkup(<Footer />);

		expect(markup).toContain('data-library-powered-by=""');
		expect(markup).toContain('href="https://openscholar.ai"');
		expect(markup).toContain("poweredBy");
	});

	it("hides the link when the setting is off", () => {
		configState.poweredBy = false;
		const markup = renderToStaticMarkup(<Footer />);

		expect(markup).not.toContain("data-library-powered-by");
		expect(markup).not.toContain("https://openscholar.ai");
	});
});
