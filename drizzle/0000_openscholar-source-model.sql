CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."creatorType" AS ENUM('artist', 'contributor', 'performer', 'composer', 'wordsBy', 'sponsor', 'cosponsor', 'author', 'editor', 'bookAuthor', 'seriesEditor', 'translator', 'counsel', 'programmer', 'reviewedAuthor', 'recipient', 'cartographer', 'inventor', 'attorneyAgent', 'podcaster', 'guest', 'director', 'castMember', 'producer', 'scriptwriter', 'commenter', 'interviewee', 'interviewer', 'presenter');--> statement-breakpoint
CREATE TYPE "public"."itemType" AS ENUM('Annotation', 'Artwork', 'Attachment', 'AudioRecording', 'Bill', 'BlogPost', 'Book', 'BookSection', 'Case', 'ComputerProgram', 'ConferencePaper', 'Dataset', 'DictionaryEntry', 'Document', 'Email', 'Preprint', 'EncyclopediaArticle', 'Film', 'ForumPost', 'Hearing', 'InstantMessage', 'Interview', 'JournalArticle', 'Letter', 'MagazineArticle', 'Manuscript', 'Map', 'NewspaperArticle', 'Note', 'Patent', 'Podcast', 'Presentation', 'RadioBroadcast', 'Report', 'Standard', 'Statute', 'TvBroadcast', 'Thesis', 'VideoRecording', 'Webpage');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entityType" text NOT NULL,
	"entityKey" varchar(8) NOT NULL,
	"operation" text NOT NULL,
	"revision" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone,
	CONSTRAINT "outbox_entity_type_valid" CHECK ("outbox"."entityType" IN ('item', 'collection')),
	CONSTRAINT "outbox_operation_valid" CHECK ("outbox"."operation" IN ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE TABLE "sourceConnection" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"scopeKind" text NOT NULL,
	"externalScopeKey" varchar(512),
	"credentialRef" varchar(255),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"syncCursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourceConnection_key_format" CHECK ("sourceConnection"."key" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
	CONSTRAINT "sourceConnection_scope_valid" CHECK ((
				("sourceConnection"."provider" = 'native' AND "sourceConnection"."key" = 'native' AND "sourceConnection"."scopeKind" = 'library' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'zotero' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'mendeley' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'openalex' AND "sourceConnection"."scopeKind" = 'query' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'dspace' AND "sourceConnection"."scopeKind" IN ('repository', 'collection', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'eprints' AND "sourceConnection"."scopeKind" IN ('repository', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
			)),
	CONSTRAINT "sourceConnection_status_valid" CHECK ("sourceConnection"."status" IN ('active', 'paused', 'removed'))
);
--> statement-breakpoint
INSERT INTO "sourceConnection" ("key", "provider", "scopeKind")
VALUES ('native', 'native', 'library');--> statement-breakpoint
CREATE TABLE "sourceRecordAlias" (
	"sourceConnectionKey" varchar(64) NOT NULL,
	"aliasKey" varchar(512) NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"kind" varchar(64) NOT NULL,
	CONSTRAINT "sourceRecordAlias_sourceConnectionKey_aliasKey_pk" PRIMARY KEY("sourceConnectionKey","aliasKey")
);
--> statement-breakpoint
CREATE TABLE "sourceSnapshot" (
	"itemKey" varchar(8) NOT NULL,
	"payload" jsonb NOT NULL,
	"remoteVersion" varchar(255),
	"payloadHash" varchar(64) NOT NULL,
	"mappingProfileVersion" varchar(64),
	"fetchedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "sourceSnapshot_itemKey_pk" PRIMARY KEY("itemKey")
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"key" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"numCollections" integer DEFAULT 0,
	"numItems" integer DEFAULT 0,
	"name" varchar,
	"deleted" integer DEFAULT 0,
	"deletedAt" timestamp with time zone,
	"parentCollection" varchar(8),
	"relations" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_key_source_connection_unique" UNIQUE("key","sourceConnectionKey"),
	CONSTRAINT "collection_key_format" CHECK ("collection"."key" ~ '^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$')
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itemKey" varchar(8),
	"parentKey" varchar(8),
	"content" text NOT NULL,
	"page" integer NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"key" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"itemType" "itemType" DEFAULT 'Artwork' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"title" varchar,
	"abstractNote" varchar,
	"creators" jsonb[],
	"artworkMedium" varchar,
	"artworkSize" varchar,
	"date" varchar,
	"shortTitle" varchar,
	"archive" varchar,
	"archiveLocation" varchar,
	"libraryCatalog" varchar,
	"callNumber" varchar,
	"url" varchar,
	"accessDate" varchar,
	"rights" varchar,
	"extra" varchar,
	"audioRecordingFormat" varchar,
	"seriesTitle" varchar,
	"numberOfVolumes" varchar,
	"volume" varchar,
	"place" varchar,
	"label" varchar,
	"runningTime" varchar,
	"ISBN" varchar,
	"billNumber" varchar,
	"code" varchar,
	"codeVolume" varchar,
	"section" varchar,
	"codePages" varchar,
	"legislativeBody" varchar,
	"session" varchar,
	"history" varchar,
	"blogTitle" varchar,
	"websiteType" varchar,
	"series" varchar,
	"seriesNumber" varchar,
	"edition" varchar,
	"publisher" varchar,
	"numPages" varchar,
	"bookTitle" varchar,
	"pages" varchar,
	"court" varchar,
	"dateDecided" varchar,
	"docketNumber" varchar,
	"reporter" varchar,
	"reporterVolume" varchar,
	"firstPage" varchar,
	"versionNumber" varchar,
	"system" varchar,
	"company" varchar,
	"programmingLanguage" varchar,
	"proceedingsTitle" varchar,
	"conferenceName" varchar,
	"DOI" varchar,
	"dictionaryTitle" varchar,
	"subject" varchar,
	"encyclopediaTitle" varchar,
	"distributor" varchar,
	"genre" varchar,
	"caseName" varchar,
	"videoRecordingFormat" varchar,
	"forumTitle" varchar,
	"postType" varchar,
	"committee" varchar,
	"documentNumber" varchar,
	"interviewMedium" varchar,
	"publicationTitle" varchar,
	"issue" varchar,
	"seriesText" varchar,
	"journalAbbreviation" varchar,
	"ISSN" varchar,
	"letterType" varchar,
	"manuscriptType" varchar,
	"mapType" varchar,
	"scale" varchar,
	"note" varchar,
	"country" varchar,
	"assignee" varchar,
	"issuingAuthority" varchar,
	"patentNumber" varchar,
	"filingDate" varchar,
	"applicationNumber" varchar,
	"priorityNumbers" varchar,
	"issueDate" varchar,
	"references" varchar,
	"legalStatus" varchar,
	"episodeNumber" varchar,
	"audioFileType" varchar,
	"presentationType" varchar,
	"meetingName" varchar,
	"programTitle" varchar,
	"network" varchar,
	"reportNumber" varchar,
	"reportType" varchar,
	"institution" varchar,
	"nameOfAct" varchar,
	"codeNumber" varchar,
	"publicLawNumber" varchar,
	"dateEnacted" varchar,
	"thesisType" varchar,
	"university" varchar,
	"studio" varchar,
	"websiteTitle" varchar,
	"linkMode" varchar,
	"contentType" varchar,
	"filename" varchar,
	"md5" varchar,
	"mtime" varchar,
	"charset" varchar,
	"apc_list" jsonb,
	"apc_paid" jsonb,
	"identifier" varchar,
	"type" varchar,
	"repository" varchar,
	"repositoryLocation" varchar,
	"format" varchar,
	"citationKey" varchar,
	"archiveID" varchar,
	"organization" varchar,
	"number" varchar,
	"status" varchar,
	"partNumber" varchar,
	"partTitle" varchar,
	"citation" varchar,
	"dateAdded" timestamp,
	"dateModified" timestamp,
	"fullTextPDF" varchar,
	"PDFCoverPageImage" varchar,
	"PDFCoverPageWidth" integer,
	"PDFCoverPageHeight" integer,
	"deleted" integer DEFAULT 0,
	"deletedAt" timestamp with time zone,
	"languageName" varchar,
	"parentItem" varchar(8),
	"relations" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_key_source_connection_unique" UNIQUE("key","sourceConnectionKey"),
	CONSTRAINT "item_key_format" CHECK ("item"."key" ~ '^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$')
);
--> statement-breakpoint
CREATE TABLE "itemToCollection" (
	"itemKey" varchar(8) NOT NULL,
	"collectionKey" varchar(8) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemToCollection_itemKey_collectionKey_pk" PRIMARY KEY("itemKey","collectionKey")
);
--> statement-breakpoint
CREATE TABLE "itemToTag" (
	"itemKey" varchar(8) NOT NULL,
	"tagName" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemToTag_itemKey_tagName_pk" PRIMARY KEY("itemKey","tagName")
);
--> statement-breakpoint
CREATE TABLE "itemToUserCollection" (
	"id" uuid DEFAULT gen_random_uuid(),
	"itemKey" varchar(8) NOT NULL,
	"userCollectionId" uuid NOT NULL,
	"userId" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "itemToUserCollection_itemKey_userCollectionId_userId_pk" PRIMARY KEY("itemKey","userCollectionId","userId"),
	CONSTRAINT "itemToUserCollection_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "language" (
	"id" uuid DEFAULT gen_random_uuid(),
	"name" varchar PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"totalRecords" integer,
	"totalItems" integer,
	"databaseUpdatedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid DEFAULT gen_random_uuid(),
	"name" varchar PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "authenticator" (
	"credentialID" text NOT NULL,
	"userId" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"credentialPublicKey" text NOT NULL,
	"counter" integer NOT NULL,
	"credentialDeviceType" text NOT NULL,
	"credentialBackedUp" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticator_userId_credentialID_pk" PRIMARY KEY("userId","credentialID"),
	CONSTRAINT "authenticator_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"password" text,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "userCollection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(255),
	"private" boolean DEFAULT false,
	"numItems" integer DEFAULT 0,
	"deleted" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userToFollow" (
	"id" uuid DEFAULT gen_random_uuid(),
	"userId" text NOT NULL,
	"followingId" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "userToFollow_userId_followingId_pk" PRIMARY KEY("userId","followingId"),
	CONSTRAINT "userToFollow_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "userToLikes" (
	"userId" text NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "userToLikes_userId_itemKey_pk" PRIMARY KEY("userId","itemKey")
);
--> statement-breakpoint
ALTER TABLE "sourceRecordAlias" ADD CONSTRAINT "sourceRecordAlias_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sourceRecordAlias" ADD CONSTRAINT "sourceRecordAlias_item_source_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."item"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceSnapshot" ADD CONSTRAINT "sourceSnapshot_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_parent_source_fk" FOREIGN KEY ("parentCollection","sourceConnectionKey") REFERENCES "public"."collection"("key","sourceConnectionKey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_parentKey_item_key_fk" FOREIGN KEY ("parentKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_parent_source_fk" FOREIGN KEY ("parentItem","sourceConnectionKey") REFERENCES "public"."item"("key","sourceConnectionKey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToCollection" ADD CONSTRAINT "itemToCollection_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToCollection" ADD CONSTRAINT "itemToCollection_collectionKey_collection_key_fk" FOREIGN KEY ("collectionKey") REFERENCES "public"."collection"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToTag" ADD CONSTRAINT "itemToTag_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToTag" ADD CONSTRAINT "itemToTag_tagName_tag_name_fk" FOREIGN KEY ("tagName") REFERENCES "public"."tag"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToUserCollection" ADD CONSTRAINT "itemToUserCollection_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToUserCollection" ADD CONSTRAINT "itemToUserCollection_userCollectionId_userCollection_id_fk" FOREIGN KEY ("userCollectionId") REFERENCES "public"."userCollection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemToUserCollection" ADD CONSTRAINT "itemToUserCollection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userCollection" ADD CONSTRAINT "userCollection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userToFollow" ADD CONSTRAINT "userToFollow_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userToFollow" ADD CONSTRAINT "userToFollow_followingId_user_id_fk" FOREIGN KEY ("followingId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userToLikes" ADD CONSTRAINT "userToLikes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userToLikes" ADD CONSTRAINT "userToLikes_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_entity_revision_unique" ON "outbox" USING btree ("entityType","entityKey","revision");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("id") WHERE "outbox"."processedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sourceConnection_provider_scope_unique" ON "sourceConnection" USING btree ("provider","externalScopeKey") WHERE "sourceConnection"."externalScopeKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sourceConnection_status_idx" ON "sourceConnection" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sourceRecordAlias_item_idx" ON "sourceRecordAlias" USING btree ("itemKey");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_source_record_unique" ON "collection" USING btree ("sourceConnectionKey","sourceRecordKey");--> statement-breakpoint
CREATE INDEX "collection_source_connection_idx" ON "collection" USING btree ("sourceConnectionKey");--> statement-breakpoint
CREATE INDEX "collection_parent_idx" ON "collection" USING btree ("parentCollection");--> statement-breakpoint
CREATE INDEX "embeddingIndex" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "itemKeyIndex" ON "embeddings" USING btree ("itemKey");--> statement-breakpoint
CREATE UNIQUE INDEX "item_source_record_unique" ON "item" USING btree ("sourceConnectionKey","sourceRecordKey");--> statement-breakpoint
CREATE INDEX "item_source_connection_idx" ON "item" USING btree ("sourceConnectionKey");--> statement-breakpoint
CREATE INDEX "item_parent_idx" ON "item" USING btree ("parentItem");--> statement-breakpoint
CREATE INDEX "itemToCollection_collection_idx" ON "itemToCollection" USING btree ("collectionKey");--> statement-breakpoint
CREATE INDEX "itemToTag_tag_idx" ON "itemToTag" USING btree ("tagName");--> statement-breakpoint
CREATE INDEX "itemToUserCollection_collection_idx" ON "itemToUserCollection" USING btree ("userCollectionId");--> statement-breakpoint
CREATE INDEX "itemToUserCollection_user_idx" ON "itemToUserCollection" USING btree ("userId");
