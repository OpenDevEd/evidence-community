import * as topicTables from "./schema/topics";
import * as notificationTables from "./schema/notifications";
import * as authorAssociationTables from "./schema/author-associations";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as collectionRelations from "./schema/relations/collection";
import * as itemRelations from "./schema/relations/item";
import * as itemToCollectionRelations from "./schema/relations/itemToCollection";
import * as collectionTable from "./schema/tables/collection";
import * as computedCacheTable from "./schema/tables/computedCache";
import * as adminItemListProjectionTable from "./schema/tables/adminItemListProjection";
import * as itemTable from "./schema/tables/item";
import * as itemCitationMetricTable from "./schema/tables/itemCitationMetric";
import * as itemOpenAccessLookupTable from "./schema/tables/itemOpenAccessLookup";
import * as itemRedirectTable from "./schema/tables/itemRedirect";
import * as institutionCountryTable from "./schema/tables/institutionCountry";
import * as itemInstitutionTable from "./schema/tables/itemInstitution";
import * as itemLinkTable from "./schema/tables/itemLink";
import * as itemToCollectionTable from "./schema/tables/itemToCollection";
import * as itemToTagTable from "./schema/tables/itemToTag";
import * as languageTable from "./schema/tables/language";
import * as readerTables from "./schema/tables/reader";
import * as statusTable from "./schema/tables/status";
import * as tagTable from "./schema/tables/tag";
import * as sourceTables from "./schema/source";
import * as publicationTables from "./schema/publication";

import * as reviewTables from "./schema/review";
import * as pdfImportTables from "./schema/pdf-import";

export const schema = {
	...pdfImportTables,
	...topicTables,
	...notificationTables,
	...authorAssociationTables,
	...reviewTables,
	...adminItemListProjectionTable,
	...itemTable,
	...itemCitationMetricTable,
	...itemOpenAccessLookupTable,
	...itemRedirectTable,
	...collectionTable,
	...computedCacheTable,
	...sourceTables,
	...publicationTables,
	...itemToCollectionTable,
	...institutionCountryTable,
	...itemInstitutionTable,
	...itemLinkTable,
	...itemToTagTable,
	...languageTable,
	...tagTable,
	...collectionRelations,
	...itemRelations,
	...itemToCollectionRelations,
	...readerTables,
	...statusTable,
};

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
