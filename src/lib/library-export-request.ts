import { z } from "zod";
import { librarySearchContextSchema } from "./search-context";

export const libraryExportRequestSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("library"), expectedCount: z.number().int().nonnegative().optional() }).strict(),
	z.object({ scope: z.literal("results"), context: librarySearchContextSchema, expectedCount: z.number().int().nonnegative().optional() }).strict(),
]);

export type LibraryExportRequest = z.infer<typeof libraryExportRequestSchema>;

export class LibraryExportError extends Error {
	constructor(
		readonly code: "exportTooLarge" | "exportChanged" | "exportPrivate" | "exportNotFound" | "exportInvalid",
		message: string,
		readonly status = 409,
	) {
		super(message);
	}
}

export const exportTooLarge = () => new LibraryExportError("exportTooLarge", "An export can contain at most 20,000 publications. Narrow the results and try again.", 413);
export const exportChanged = () => new LibraryExportError("exportChanged", "The selected records changed. Refresh the results and try again.");
