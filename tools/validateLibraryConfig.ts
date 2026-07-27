import {
	LibraryConfigSourceError,
	validateLibraryConfigFile,
} from "../src/config/library-config/source";

const sourcePath = process.argv[2];

async function main() {
	if (!sourcePath) {
		console.error("Usage: npm run config:validate -- <path>");
		process.exitCode = 1;
		return;
	}

	try {
		const config = await validateLibraryConfigFile(sourcePath);
		console.log(
			`Valid library configuration: schema ${config.schemaVersion}, revision ${config.revision}, updated ${config.updatedAt}`,
		);
	} catch (error) {
		if (error instanceof LibraryConfigSourceError) {
			console.error(`${error.code}: ${error.message}`);
			error.details.forEach((detail) => console.error(`- ${detail}`));
		} else {
			console.error(error);
		}
		process.exitCode = 1;
	}
}

void main();
