import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as collectionRelations from "./schema/relations/collection";
import * as itemRelations from "./schema/relations/item";
import * as itemToCollectionRelations from "./schema/relations/itemToCollection";
import * as userCollectionRelations from "./schema/relations/userCollection";
import * as userRelations from "./schema/relations/user";
import * as userToFollowRelations from "./schema/relations/userToFollow";
import * as userToLikesRelations from "./schema/relations/userToLikes";
import * as collectionTable from "./schema/tables/collection";
import * as adminItemListProjectionTable from "./schema/tables/adminItemListProjection";
import * as embeddingsTable from "./schema/tables/embeddings";
import * as itemTable from "./schema/tables/item";
import * as itemToCollectionTable from "./schema/tables/itemToCollection";
import * as itemToTagTable from "./schema/tables/itemToTag";
import * as itemToUserCollectionRelations from "./schema/relations/itemToUserCollection";
import * as itemToUserCollectionTable from "./schema/tables/itemToUserCollection";
import * as languageTable from "./schema/tables/language";
import * as statusTable from "./schema/tables/status";
import * as tagTable from "./schema/tables/tag";
import * as userCollectionTable from "./schema/tables/userCollection";
import * as userTable from "./schema/tables/user";
import * as userToFollowTable from "./schema/tables/userToFollow";
import * as userToLikesTable from "./schema/tables/userToLikes";
import * as sourceTables from "./schema/source";

export const schema = {
	...adminItemListProjectionTable,
	...itemTable,
	...collectionTable,
	...sourceTables,
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

export type Database = NodePgDatabase<typeof schema>;
