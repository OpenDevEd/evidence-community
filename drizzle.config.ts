import { readFileSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

import { libraryConfigSchema } from "./src/config/library-config/schema";
import { resolveLibraryConfigPath } from "./src/config/library-config/source";

const libraryConfig = libraryConfigSchema.parse(
	JSON.parse(readFileSync(resolveLibraryConfigPath(), "utf8")),
);

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema/*",
	dialect: "postgresql",
	dbCredentials: {
		url: libraryConfig.services.database.url,
	},
});
