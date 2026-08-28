import { test } from "@playwright/test";

import { openAdmin } from "./admin-login";
import {
	expectLogoFits,
	logoBoxes,
	logoShapes,
	serveShape,
} from "./brand-logo-boxes";

for (const shape of logoShapes) {
	test(`fits a ${shape.name} logo into the admin toolbar`, async ({
		page,
	}) => {
		await serveShape(page, shape);
		await openAdmin(page);

		await expectLogoFits(
			page,
			logoBoxes.admin,
			shape,
			`admin toolbar ${shape.name}`,
		);
	});
}
