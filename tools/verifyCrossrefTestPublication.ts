import { runPublicationSandboxQualification } from "./publicationSandboxQualification";

runPublicationSandboxQualification("crossref").catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
