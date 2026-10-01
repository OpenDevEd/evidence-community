-- Readers sign in with OpenScholar now (plan openscholar-reader-accounts).
-- The old per-library reader accounts, likes, collections and follows are
-- dropped, as decided on 2026-10-01; Better Auth's tables and the new likes and
-- collections tables take their own reader_* names.
-- Rollback: drizzle/rollback/0074_reader-accounts.sql recreates the old tables
-- empty beside the new ones and keeps everything saved on reader_*.
DROP TABLE "itemToUserCollection" CASCADE;--> statement-breakpoint
DROP TABLE "account" CASCADE;--> statement-breakpoint
DROP TABLE "authenticator" CASCADE;--> statement-breakpoint
DROP TABLE "session" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
DROP TABLE "verificationToken" CASCADE;--> statement-breakpoint
DROP TABLE "userCollection" CASCADE;--> statement-breakpoint
DROP TABLE "userToFollow" CASCADE;--> statement-breakpoint
DROP TABLE "userToLikes" CASCADE;--> statement-breakpoint
CREATE TABLE "reader_account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_bookmark" (
	"userId" text NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_bookmark_userId_itemKey_pk" PRIMARY KEY("userId","itemKey")
);
--> statement-breakpoint
CREATE TABLE "reader_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" varchar(24) NOT NULL,
	"description" varchar(200),
	"private" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_collection_item" (
	"collectionId" uuid NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_collection_item_collectionId_itemKey_pk" PRIMARY KEY("collectionId","itemKey")
);
--> statement-breakpoint
CREATE TABLE "reader_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "reader_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"checkedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reader_account" ADD CONSTRAINT "reader_account_userId_reader_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."reader_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_bookmark" ADD CONSTRAINT "reader_bookmark_userId_reader_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."reader_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_bookmark" ADD CONSTRAINT "reader_bookmark_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_collection" ADD CONSTRAINT "reader_collection_userId_reader_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."reader_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_collection_item" ADD CONSTRAINT "reader_collection_item_collectionId_reader_collection_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."reader_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_collection_item" ADD CONSTRAINT "reader_collection_item_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_session" ADD CONSTRAINT "reader_session_userId_reader_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."reader_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_account_userId_idx" ON "reader_account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_account_provider_idx" ON "reader_account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "reader_bookmark_itemKey_idx" ON "reader_bookmark" USING btree ("itemKey");--> statement-breakpoint
CREATE INDEX "reader_collection_userId_idx" ON "reader_collection" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "reader_collection_item_itemKey_idx" ON "reader_collection_item" USING btree ("itemKey");--> statement-breakpoint
CREATE INDEX "reader_session_userId_idx" ON "reader_session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "reader_verification_identifier_idx" ON "reader_verification" USING btree ("identifier");
