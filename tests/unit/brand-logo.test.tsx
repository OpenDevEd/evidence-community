// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import {
	InstitutionLogo,
	LibraryLogo,
} from "@/components/library/LibraryIdentity";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { maximalLibraryConfig } from "../fixtures/library-config";

const config = projectPublicLibraryConfig(
	libraryConfigSchema.parse(maximalLibraryConfig),
);

function renderLibraryLogo(place: "admin" | "cookie" | "footer" | "header") {
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		<NextIntlClientProvider
			locale="en-GB"
			messages={{
				ui: { logoAlt: "Logo for {company} in {theme} mode" },
			}}
		>
			<LibraryConfigProvider config={config}>
				<LibraryLogo place={place} />
			</LibraryConfigProvider>
		</NextIntlClientProvider>,
	);

	return container;
}

describe("library logo boxes", () => {
	it.each(["header", "footer", "cookie", "admin"] as const)(
		"draws the %s logo inside its own sizing box",
		(place) => {
			const container = renderLibraryLogo(place);
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

	it.each(["badge", "row"] as const)(
		"draws an institution's %s logo inside its own sizing box",
		(size) => {
			const container = document.createElement("div");
			container.innerHTML = renderToStaticMarkup(
				<InstitutionLogo
					alt="Institution One"
					logoUrl="https://assets.example.org/institution.png"
					size={size}
				/>,
			);
			const box = container.querySelector(
				'[data-brand-logo-box="institution"]',
			);

			expect(box).not.toBeNull();
			expect(box!.querySelectorAll("img")).toHaveLength(1);
			expect(container.querySelectorAll("img")).toHaveLength(1);
		},
	);

	it("shows the fallback inside the box when an institution has no logo", () => {
		const container = document.createElement("div");
		container.innerHTML = renderToStaticMarkup(
			<InstitutionLogo
				alt="Institution One"
				fallback={<span data-testid="fallback" />}
				size="row"
			/>,
		);
		const box = container.querySelector(
			'[data-brand-logo-box="institution"]',
		);

		expect(box).not.toBeNull();
		expect(box!.querySelector('[data-testid="fallback"]')).not.toBeNull();
		expect(container.querySelectorAll("img")).toHaveLength(0);
	});

	it("renders nothing for an institution with neither a logo nor a fallback", () => {
		expect(
			renderToStaticMarkup(<InstitutionLogo alt="Institution One" />),
		).toBe("");
	});
});
