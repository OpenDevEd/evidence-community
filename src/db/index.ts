import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as itemTable from "./schema/tables/item";
import * as collectionTable from "./schema/tables/collection";
import * as groupTable from "./schema/tables/group";
import * as itemToCollectionTable from "./schema/tables/itemToCollection";
import * as itemToTagTable from "./schema/tables/itemToTag";
import * as languageTable from "./schema/tables/language";
import * as tagTable from "./schema/tables/tag";

import * as itemRelations from './schema/relations/item';
import * as collectionRelations from './schema/relations/collection';
import * as itemToCollectionRelations from './schema/relations/itemToCollection';

import * as userTable from './schema/tables/user';
import * as userToLikesTable from './schema/tables/userToLikes';
import * as userRelations from './schema/relations/user';
import * as userToLikesRelations from './schema/relations/userToLikes';

import * as userToFollowTable from './schema/tables/userToFollow';
import * as userToFollowRelations from './schema/relations/userToFollow';
import * as userCollectionTable from './schema/tables/userCollection';
import * as userCollectionRelations from './schema/relations/userCollection';
import * as itemToUserCollectionTable from './schema/tables/itemToUserCollection';
import * as itemToUserCollectionRelations from './schema/relations/itemToUserCollection';
import * as embeddingsTable from './schema/tables/embeddings';

import * as statusTable from './schema/tables/status';

export const schema = {
    ...itemTable,
    ...collectionTable,
    ...groupTable,
    ...itemToCollectionTable,
    ...itemToTagTable,
    ...languageTable,
    ...tagTable,
    ...collectionRelations,
    ...itemRelations,
    ...itemToCollectionRelations,
    ...userTable,
    ...userToLikesTable,
    ...userRelations,
    ...userToLikesRelations,
    ...userToFollowTable,
    ...userToFollowRelations,
    ...userCollectionTable,
    ...userCollectionRelations,
    ...itemToUserCollectionTable,
    ...itemToUserCollectionRelations,
    ...statusTable,
    ...embeddingsTable,
};

type DBType = NodePgDatabase<typeof schema> & {
	$client: Pool;
};

// Fix for "sorry, too many clients already"
declare global {
	var db: DBType | undefined;
}

let db: DBType;
const databaseUrl = process.env.DATABASE_URL_POST;

if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is not set");
}

const createDb = () => {
	const pool = new Pool({
		connectionString: databaseUrl,
		max: process.env.NODE_ENV === "production" ? 20 : 10,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 30000,
		keepAlive: true,
	});

	pool.on("error", (error) => {
		console.error("Unexpected PostgreSQL pool error:", error);
	});

	return drizzle(pool, { schema });
};

if (process.env.NODE_ENV === "production") {
	db = createDb();
} else {
	if (!global.db) {
		global.db = createDb();
	}
	db = global.db;
}

export { db };
