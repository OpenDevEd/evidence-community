import { drizzle } from 'drizzle-orm/node-postgres';

import * as itemTable from "./schema/tables/item";
import * as collectionTable from "./schema/tables/collection";
import * as groupTable from "./schema/tables/group";
import * as itemToCollectionTable from "./schema/tables/itemToCollection";
import * as itemToTagTable from "./schema/tables/itemToTag";
import * as languageTable from "./schema/tables/language";
import * as tagTable from "./schema/tables/tag";

export const schema = {
    ...itemTable,
    ...collectionTable,
    ...groupTable,
    ...itemToCollectionTable,
    ...itemToTagTable,
    ...languageTable,
    ...tagTable
}

export const db = drizzle(process.env.DATABASE_URL_POST!, { schema });