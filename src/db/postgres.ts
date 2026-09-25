import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./database-schema";

const MAX_DATABASE_CONNECTIONS = 3;

export function createPostgresDatabaseResource(
	databaseUrl: string,
	maxConnections = MAX_DATABASE_CONNECTIONS,
) {
	const pool = new Pool({
		connectionString: databaseUrl,
		max: maxConnections,
		idleTimeoutMillis: 5_000,
		connectionTimeoutMillis: 5_000,
	});

	return {
		database: drizzle({ client: pool, schema }),
		dispose: () => pool.end(),
		pool,
	};
}
