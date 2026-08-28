// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { BrandLogo } from "@/components/library/LibraryIdentity";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { maximalLibraryConfig } from "../fixtures/library-config";

const config = projectPublicLibraryConfig(
	libraryConfigSchema.parse(maximalLibraryConfig),
);

function renderBrandLogo(place: "cookie" | "footer" | "header") {
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		<NextIntlClientProvider
			locale="en-GB"
			messages={{
				ui: { logoAlt: "Logo for {company} in {theme} mode" },
			}}
		>
			<LibraryConfigProvider config={config}>
				<BrandLogo place={place} />
			</LibraryConfigProvider>
		</NextIntlClientProvider>,
	);

	return container;
}

describe("library logo boxes", () => {
	it.each(["header", "footer", "cookie"] as const)(
		"draws the %s logo inside its own sizing box",
		(place) => {
			const container = renderBrandLogo(place);
			const box = container.querySelector(
				`[data-brand-logo-box="${place}"]`,
			);

			expect(box).not.toBeNull();
			expect(box!.querySelectorAll("img[data-library-logo]")).toHaveLength(
				2,
			);
			expect(
				container.querySelectorAll("img[data-library-logo]"),
			).toHaveLength(2);
		},
	);
});
