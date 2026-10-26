import { vi } from "vitest";

// Tests that replace a library's search clients don't have its database either. Readers then search the engine the
// configuration chooses, as before a library's first build; live-engine.test.ts checks the real read.
vi.mock("@/lib/search-engines/live-engine", () => ({ readLiveSearchEngine: async () => null }));
