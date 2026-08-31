import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeAsset } from "@/components/library/RuntimeAsset";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

const institutions = libraryConfigSchema.parse(
	maximalLibraryConfig,
).institutions;

describe("runtime institution assets", () => {
	it("matches configured institution names exactly and case-insensitively", () => {
		expect(
			findInstitutionWithLogo(institutions, [
				"Unconfigured Institution",
				"institution one",
			]),
		).toEqual(institutions[0]);
		expect(
			findInstitutionWithLogo(
				institutions,
				"Institution One Research Unit",
			),
		).toBeUndefined();
	});

	it("ignores configured institutions without logos", () => {
		expect(
			findInstitutionWithLogo(
				[{ id: "text-only", name: "Text Only" }],
				"Text Only",
			),
		).toBeUndefined();
	});
});

describe("runtime asset renderer", () => {
	it("renders a Hugeicons sprite reference by ID", () => {
		const markup = renderToStaticMarkup(
			<RuntimeAsset
				reference="LibraryIcon"
				alt=""
				className="size-5"
			/>,
		);

		expect(markup).toContain('data-runtime-asset="platform"');
		expect(markup).toContain('data-platform-icon="LibraryIcon"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain("<svg");
		expect(markup).toContain(
			'href="/library-icons/11.svg#LibraryIcon"',
		);
	});

	it.each([".svg", ".png", ".ico"])(
		"renders an uploaded %s URL with native image semantics",
		(extension) => {
			const markup = renderToStaticMarkup(
				<RuntimeAsset
					reference={`https://assets.example.org/icon${extension}`}
					alt="Partner icon"
					className="size-5"
				/>,
			);

			expect(markup).toContain('data-runtime-asset="remote"');
			expect(markup).toContain(
				`src="https://assets.example.org/icon${extension}"`,
			);
			expect(markup).toContain('alt="Partner icon"');
			expect(markup).not.toContain("<svg");
		},
	);
});
