// Reads again a library's published PDFs whose saved text is nearly empty, so a reader fix reaches PDFs published
// before it. Run once in the library's source-sync container: npm run pdf:reread-text
import { openLibraryDatabaseProcess } from "../src/config/library-config/process";
import { createSupabaseFileStorage } from "../src/lib/admin/file-storage";
import { rereadNearlyEmptyPdfText } from "../src/lib/admin/reread-pdf-text";

async function main() {
	const library = await openLibraryDatabaseProcess();
	try {
		const storage = createSupabaseFileStorage(library.config.services.storage);
		const result = await rereadNearlyEmptyPdfText(library.databaseResource.database, storage);
		console.log("PDF text read again", result);
		// A storage or reader failure must not look like a finished run.
		if (result.failed > 0) process.exitCode = 1;
	} finally {
		await library.close();
	}
}

main().then(
	() => process.exit(process.exitCode ?? 0),
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
