import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Footer from "@/components/layout/Footer";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
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
		capabilities: { analytics: false, sessionReplay: false },
		openPreferences: vi.fn(),
		setConsentState: vi.fn(),
	}),
}));
vi.mock("@/components/library/LibraryIdentity", () => ({
	FunderLogo: () => null,
	FundingPartners: () => null,
	InstitutionLogo: () => null,
	LibraryLogo: () => null,
	useLibraryLogo: () => ({
		isLoaded: true,
		onLogoSettled: () => undefined,
	}),
}));

const configState = { poweredBy: true };
// The link goes to the OpenScholar the library belongs to, taken from its own page there.
const openScholar = `${new URL(libraryConfigSchema.parse(minimalLibraryConfig).authentication.openScholar.libraryUrl).origin}/`;

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
	it("links to the library's own OpenScholar when the setting is on", () => {
		configState.poweredBy = true;
		const markup = renderToStaticMarkup(<Footer />);

		expect(markup).toContain('data-library-powered-by=""');
		expect(markup).toContain(`href="${openScholar}"`);
		expect(markup).toContain("poweredBy");
	});

	it("hides the link when the setting is off", () => {
		configState.poweredBy = false;
		const markup = renderToStaticMarkup(<Footer />);

		expect(markup).not.toContain("data-library-powered-by");
		expect(markup).not.toContain(`href="${openScholar}"`);
	});
});
