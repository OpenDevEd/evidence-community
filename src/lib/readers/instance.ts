import "server-only";

import { after } from "next/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";

import { createReaderAuth, type ReaderAuth } from "./auth";
import { checkReaderSoon } from "./check";

const instances = new WeakMap<LibraryServerConfig, Promise<{ auth: ReaderAuth; database: Database }>>();

/** One auth instance per active configuration revision. Reading a session checks the reader's account after the response. */
export async function getReaderAuthForConfig(config: LibraryServerConfig) {
	let instance = instances.get(config);
	if (!instance) {
		instance = (async () => {
			const database = await getDatabaseForConfig(config);
			const auth: ReaderAuth = createReaderAuth(config, database, (userId) =>
				after(() => checkReaderSoon({ auth, config, database, userId })),
			);
			return { auth, database };
		})();
		instances.set(config, instance);
		instance.catch(() => instances.delete(config));
	}
	return instance;
}

export async function getReaderAuth() {
	return getReaderAuthForConfig(await getLibraryConfig());
}
