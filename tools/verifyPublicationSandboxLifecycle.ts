import { runPublicationSandboxQualification } from "./publicationSandboxQualification";

runPublicationSandboxQualification("lifecycle").catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
