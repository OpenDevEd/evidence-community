import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "./library-config";

export function publicationTestConfig({zenodoEnabled = true, retryLimit = 8, nightlyUtcTime = "02:00"} = {}) {
 return libraryConfigSchema.parse({
  ...maximalLibraryConfig,
  identity: {...maximalLibraryConfig.identity, baseUrl: "https://library.example.org"},
  sources: [],
  services: {...maximalLibraryConfig.services, publication: {
   crossref: {
    enabled: true, environment: "test", loginId: "test-login", depositorName: "Evidence Library",
    email: "doi@example.org", password: "test-password", registrant: "Evidence Library",
    prefix: "10.5555", suffixNamespace: "library.",
   },
   zenodo: {
    enabled: zenodoEnabled, environment: "sandbox", token: "sandbox-token",
    defaultIdentifierPolicy: "reuse-crossref", accessRight: "open", license: "cc-by-4.0",
   },
   worker: {batchSize: 25, leaseSeconds: 900, retryLimit, nightlyUtcTime},
  }},
 });
}
