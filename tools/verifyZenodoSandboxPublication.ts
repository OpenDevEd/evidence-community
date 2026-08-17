import { runPublicationSandboxQualification } from "./publicationSandboxQualification";

runPublicationSandboxQualification("zenodo").catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
